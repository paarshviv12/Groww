import { parseSignature, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { settlerAbi } from "../generated/settler";
import { authNonceOf, explorerAddr, explorerTx, jsonSafe, netConfig, publicClientFor, receiveAuthTypes, revertReason, tokenDomain, type NetConfig } from "../chain";
import { verifyCart, usdToUnits, validateCart } from "../hsp/cart";
import { Tracer } from "../trace";
import type { DeliverResult, MerchantClient } from "./merchant";

export interface Policy { maxPerPaymentUsd: string; minMinutesBeforeExpiry: number }
export const defaultPolicy = (): Policy => ({ maxPerPaymentUsd: process.env.PAYER_MAX_USD ?? "0.05", minMinutesBeforeExpiry: 5 });

export interface PayerConfig { net: NetConfig; agentKey: Hex; policy: Policy }

export function payerConfigFromEnv(): PayerConfig {
  const k = (process.env.PAYER_KEY ?? process.env.AGENT_KEY) as string | undefined;
  if (!k) throw new Error("PAYER_KEY (or AGENT_KEY) is not set");
  return { net: netConfig(), agentKey: (k.startsWith("0x") ? k : `0x${k}`) as Hex, policy: defaultPolicy() };
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export interface RunMeta { network: string; chainId: number; settler: string; token: string; explorer: string; payer: string; payTo?: string }
export interface RunSummary {
  ok: boolean; cartHash?: string; txHash?: string; delivery?: DeliverResult; error?: string; meta?: RunMeta;
}

/**
 * The payment agent: discovers a merchant, checks the cart it is offered against its own policy,
 * signs ONE wallet authorisation that is cryptographically tied to that exact cart, and checks the
 * on-chain settlement before it accepts the delivery.
 */
async function runInner(
  cfg: PayerConfig, merchant: MerchantClient, req: { serviceId: string; target?: string }, tracer: Tracer,
): Promise<RunSummary> {
  const { net } = cfg;
  const account = privateKeyToAccount(cfg.agentKey);
  const pc = publicClientFor(net);
  try {
    // 1 — discovery
    const card = await merchant.card();
    tracer.emit({
      actor: "payer", status: "ok", title: "Discovered the receiving agent",
      detail: `${card.name} offers ${card.services.length} services on ${net.name === "mainnet" ? "HSK Chain mainnet" : net.name}.`,
      data: { agent: card.name, payTo: card.payTo, services: card.services.map((s) => `${s.title} · $${s.priceUsd}`) },
    });

    // 2 — the merchant publishes its payment conditions as a Cart Mandate
    const cart = await merchant.quote(req);
    const { effectiveUsd } = validateCart(cart.contents);
    const { cartHash, issuer } = await verifyCart(cart, card.merchantPublicKeyPem);
    tracer.emit({
      actor: "merchant", status: "ok", hspState: "payment-required", title: "Cart Mandate issued",
      detail: `${cart.contents.payment_request.details.display_items?.[0]?.label} for $${effectiveUsd[0]} USDC. Signed with the merchant's ES256K key.`,
      data: { cart_mandate_id: cart.contents.id, payment_request_id: cart.contents.payment_request.details.id, cart_hash: cartHash, expires: cart.contents.cart_expiry, pay_to: card.payTo, cart: cart.contents },
    });

    // 3 — the payer verifies what it was offered
    const m = cart.contents.payment_request.method_data[0].data;
    const checks: [string, boolean][] = [
      ["Merchant signature valid (ES256K)", issuer === cart.contents.merchant_name],
      ["Signed cart_hash matches the cart contents", true], // verifyCart throws otherwise
      ["Payee equals the address in the agent card", m.pay_to.toLowerCase() === card.payTo.toLowerCase()],
      ["Chain and token are the ones this agent allows", m.chain_id === net.chainId && m.contract_address.toLowerCase() === net.usdc.toLowerCase()],
      ["Cart is not about to expire", Date.parse(cart.contents.cart_expiry) - Date.now() > cfg.policy.minMinutesBeforeExpiry * 60_000],
      [`Amount $${effectiveUsd[0]} is within the $${cfg.policy.maxPerPaymentUsd} per-payment limit`, usdToUnits(effectiveUsd[0]) <= usdToUnits(cfg.policy.maxPerPaymentUsd)],
    ];
    const failed = checks.filter(([, ok]) => !ok);
    tracer.emit({
      actor: "policy", status: failed.length ? "fail" : "ok",
      title: failed.length ? "Policy check failed. Payment refused" : "Policy check passed",
      detail: failed.length ? failed.map(([c]) => c).join("; ") : "The agent will only pay this exact cart.",
      data: { checks: checks.map(([c, ok]) => `${ok ? "pass" : "FAIL"} · ${c}`) },
    });
    if (failed.length) return { ok: false, cartHash, error: `policy refused: ${failed.map(([c]) => c).join("; ")}` };

    // 4 — the Payment Mandate: one EIP-3009 signature whose nonce is derived from the cart hash + payee
    const cartHashHex = `0x${cartHash}` as Hex;
    const nonce = authNonceOf(net, cartHashHex, card.payTo);
    let nonceOnChain: string | undefined;
    try { nonceOnChain = await pc.readContract({ address: net.settler, abi: settlerAbi, functionName: "authNonceFor", args: [cartHashHex, card.payTo] }); } catch { /* RPC read optional */ }
    const amount = usdToUnits(effectiveUsd[0]);
    const now = Math.floor(Date.now() / 1000);
    const message = { from: account.address, to: net.settler, value: amount, validAfter: 0n, validBefore: BigInt(now + 900), nonce };
    const domain = await tokenDomain(net, pc);
    const signature = await account.signTypedData({ domain, types: receiveAuthTypes, primaryType: "ReceiveWithAuthorization", message });
    const p = parseSignature(signature);
    const v = Number(p.v ?? BigInt(27 + (p.yParity ?? 0)));
    tracer.emit({
      actor: "payer", status: "ok", hspState: "payment-submitted", title: "Payment Mandate signed",
      detail: "One wallet signature authorises exactly this cart: the cart hash and payee are inside the signed nonce.",
      data: {
        signer: account.address, amount_units: amount.toString(), nonce,
        nonce_matches_contract: nonceOnChain ? nonceOnChain === nonce : "not checked (no RPC)", valid_for: "15 minutes",
        signature,
      },
      links: net.explorer ? [{ label: "Payer wallet", href: explorerAddr(net, account.address) }] : undefined,
    });

    // 5 — the merchant verifies, dry-runs and settles on-chain
    const paid = await merchant.pay({
      cart, payer: account.address,
      authorization: { validAfter: "0", validBefore: String(message.validBefore), v, r: p.r, s: p.s },
    });
    tracer.emit({ actor: "merchant", status: "ok", hspState: "payment-verified", title: "Mandate verified by dry-run", detail: "The chain confirmed the signature, cart, amount and payee line up before any gas was spent." });
    tracer.emit({
      actor: "chain", status: "ok", hspState: "payment-included", title: `Settled in block ${paid.blockNumber}`,
      detail: `Gas used ${paid.gasUsed}. ${paid.relayer.toLowerCase() === account.address.toLowerCase() ? "The merchant relayed the transaction (same gas wallet as the payer in this setup)." : "The payer paid no gas; the merchant relayed the transaction."}`,
      data: { tx: paid.txHash, block: paid.blockNumber },
      links: paid.explorerUrl ? [{ label: "View transaction", href: paid.explorerUrl }] : undefined,
    });

    // 6 — the payer checks the chain itself before accepting delivery
    const onchain = await pc.readContract({ address: net.settler, abi: settlerAbi, functionName: "receipts", args: [cartHashHex] });
    const [rPayer, rPayee, , rAmount, , rNonce] = onchain as readonly [Address, Address, Address, bigint, bigint, Hex];
    const match = rPayer.toLowerCase() === account.address.toLowerCase() && rPayee.toLowerCase() === card.payTo.toLowerCase() && rAmount === amount && rNonce === nonce;
    tracer.emit({
      actor: "payer", status: match ? "ok" : "fail", title: match ? "On-chain receipt matches the cart" : "On-chain receipt does NOT match",
      detail: "Read straight from the settlement contract, not from the merchant's word.",
      data: { payer: rPayer, payee: rPayee, amount_units: rAmount.toString(), cart_hash: cartHashHex },
      links: net.explorer ? [{ label: "Settlement contract", href: explorerAddr(net, net.settler) }] : undefined,
    });
    if (!match) return { ok: false, cartHash, txHash: paid.txHash, error: "receipt mismatch" };

    // 7 — delivery
    const delivery = await merchant.deliver({ cart, txHash: paid.txHash });
    tracer.emit({
      actor: "merchant", status: "ok", hspState: "payment-finalized", title: "Service delivered",
      detail: `${delivery.serviceId} result released after the merchant re-checked the settlement event.`,
      data: { result: jsonSafe(delivery.result), delivery_hash: delivery.deliveryHash },
    });
    // 8 — a replay of the very same signed mandate must be refused by the contract
    const replayMandate = { cartHash: cartHashHex, token: m.contract_address as Address, payee: card.payTo, amount, cartExpiry: BigInt(Math.floor(Date.parse(cart.contents.cart_expiry) / 1000)) };
    try {
      await pc.simulateContract({
        account, address: net.settler, abi: settlerAbi, functionName: "settle",
        args: [replayMandate, account.address, { validAfter: 0n, validBefore: message.validBefore, v, r: p.r, s: p.s }],
      });
      tracer.emit({ actor: "chain", status: "fail", title: "Replay was NOT rejected", detail: "The contract accepted the same mandate twice." });
    } catch (e) {
      tracer.emit({ actor: "chain", status: "ok", title: "Replay attempt refused", detail: `Submitting the same signed mandate again reverts: ${revertReason(e)}.` });
    }
    return { ok: true, cartHash, txHash: paid.txHash, delivery };
  } catch (e) {
    const msg = (e as Error).message;
    tracer.emit({ actor: "payer", status: "fail", hspState: "payment-failed", title: "Flow stopped", detail: msg });
    return { ok: false, error: msg };
  }
}
export { explorerTx };

export async function runPaymentFlow(
  cfg: PayerConfig, merchant: MerchantClient, req: { serviceId: string; target?: string }, tracer: Tracer,
): Promise<RunSummary> {
  const res = await runInner(cfg, merchant, req, tracer);
  const card = await merchant.card().catch(() => undefined);
  return {
    ...res,
    meta: { network: cfg.net.name, chainId: cfg.net.chainId, settler: cfg.net.settler, token: cfg.net.usdc, explorer: cfg.net.explorer, payer: privateKeyToAccount(cfg.agentKey).address, payTo: card?.payTo },
  };
}
