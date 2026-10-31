import { parseSignature, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { settlerAbi } from "../generated/settler";
import { authNonceOf, revertReason, publicClientFor, receiveAuthTypes, tokenDomain } from "../chain";
import { usdToUnits, validateCart, verifyCart } from "../hsp/cart";
import { Tracer } from "../trace";
import type { MerchantClient } from "./merchant";
import type { PayerConfig, RunSummary } from "./payer";

const ATTACKER = "0x000000000000000000000000000000000000dEaD" as Address;

/**
 * "Try to cheat": the payer signs one honest authorisation for one cart, then a would-be thief tampers with the
 * mandate before submitting it. Every variant is dry-run against the real contract (no gas, no funds move).
 */
export async function runTamperDemo(cfg: PayerConfig, merchant: MerchantClient, tracer: Tracer): Promise<RunSummary> {
  const { net } = cfg;
  const account = privateKeyToAccount(cfg.agentKey);
  const pc = publicClientFor(net);
  try {
    const card = await merchant.card();
    const cart = await merchant.quote({ serviceId: "chain-pulse" });
    const { effectiveUsd } = validateCart(cart.contents);
    const { cartHash } = await verifyCart(cart, card.merchantPublicKeyPem);
    const m = cart.contents.payment_request.method_data[0].data;
    tracer.emit({
      actor: "merchant", status: "ok", hspState: "payment-required", title: "Cart Mandate issued",
      detail: `Chain pulse for $${effectiveUsd[0]} USDC.`,
      data: { cart_mandate_id: cart.contents.id, cart_hash: cartHash, pay_to: card.payTo, cart: cart.contents },
    });

    const hashHex = `0x${cartHash}` as Hex;
    const amount = usdToUnits(effectiveUsd[0]);
    const nonce = authNonceOf(net, hashHex, card.payTo);
    const message = { from: account.address, to: net.settler, value: amount, validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + 900), nonce };
    const signature = await account.signTypedData({ domain: await tokenDomain(net, pc), types: receiveAuthTypes, primaryType: "ReceiveWithAuthorization", message });
    const sg = parseSignature(signature);
    const v = Number(sg.v ?? BigInt(27 + (sg.yParity ?? 0)));
    const auth = { validAfter: 0n, validBefore: message.validBefore, v, r: sg.r, s: sg.s };
    tracer.emit({
      actor: "payer", status: "ok", hspState: "payment-submitted", title: "Payment Mandate signed",
      detail: "An honest signature for this one cart. Now someone tries to bend it.",
      data: { signer: account.address, nonce, signature },
    });

    const honest = { cartHash: hashHex, token: m.contract_address as Address, payee: card.payTo, amount, cartExpiry: BigInt(Math.floor(Date.parse(cart.contents.cart_expiry) / 1000)) };
    const tryIt = async (label: string, mandate: typeof honest, payer: Address = account.address) => {
      try {
        await pc.simulateContract({ account, address: net.settler, abi: settlerAbi, functionName: "settle", args: [mandate, payer, auth] });
        return { accepted: true as const, reason: "" };
      } catch (e) {
        return { accepted: false as const, reason: revertReason(e), label };
      }
    };

    const control = await tryIt("control", honest);
    tracer.emit({
      actor: "chain", status: control.accepted ? "ok" : "fail",
      title: control.accepted ? "Control: the honest mandate would be accepted" : "Control failed. The honest mandate was refused",
      detail: control.accepted ? "Dry-run only. Nothing was sent and no funds moved." : control.reason,
    });

    const attacks: [string, string, typeof honest, Address?][] = [
      ["Redirect the money", "Swap the payee for a thief's address.", { ...honest, payee: ATTACKER }],
      ["Raise the price", "Ask for ten times the signed amount.", { ...honest, amount: amount * 10n }],
      ["Reuse the signature on another cart", "Present the same signature for a different cart.", { ...honest, cartHash: `0x${"ab".repeat(32)}` as Hex }],
      ["Impersonate the payer", "Claim the signature came from a different wallet.", honest, ATTACKER],
    ];
    let allRefused = control.accepted;
    for (const [title, how, mandate, payer] of attacks) {
      const r = await tryIt(title, mandate, payer);
      if (r.accepted) allRefused = false;
      tracer.emit({
        actor: "chain", status: r.accepted ? "fail" : "ok", title: r.accepted ? `${title}: ACCEPTED (bad)` : `${title}: refused`,
        detail: r.accepted ? how : `${how} The contract reverted: ${r.reason.replace(/\.+$/, "")}.`,
        data: { attack: title },
      });
    }
    tracer.emit({
      actor: "policy", status: allRefused ? "ok" : "fail", title: allRefused ? "Every tampered mandate was refused" : "A tampered mandate got through",
      detail: "The signature covers the cart hash, payee and amount, so changing any of them invalidates it.",
    });
    return { ok: allRefused, cartHash, meta: { network: net.name, chainId: net.chainId, settler: net.settler, token: net.usdc, explorer: net.explorer, payer: account.address, payTo: card.payTo } };
  } catch (e) {
    tracer.emit({ actor: "payer", status: "fail", hspState: "payment-failed", title: "Flow stopped", detail: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
}
