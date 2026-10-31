import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { settlerAbi } from "../generated/settler";
import {
  erc20Abi, explorerTx, netConfig, publicClientFor, walletClientFor, jsonSafe, type NetConfig,
} from "../chain";
import { cartHashOf, canonicalJson, sha256Hex } from "../hsp/canonical";
import {
  X402, loadPrivateKey, publicKeyPemOf, signCart, validateCart, verifyCart, usdToUnits,
  type CartContents, type CartMandate,
} from "../hsp/cart";

// ---------- public shapes (what travels between the two agents) ----------
export interface Service { id: string; title: string; description: string; priceUsd: string }
export interface MerchantCard {
  name: string; description: string; services: Service[];
  payTo: Address; merchantPublicKeyPem: string;
  network: { name: string; chainId: number; token: Address; settler: Address; explorer: string };
}
export interface Authorization { validAfter: string; validBefore: string; v: number; r: Hex; s: Hex }
export interface PayRequest { cart: CartMandate; payer: Address; authorization: Authorization }
export interface PayResult { relayer: Address; txHash: Hex; blockNumber: string; gasUsed: string; simulation: "passed"; explorerUrl: string }
export interface DeliverResult { delivered: true; serviceId: string; result: Record<string, unknown>; deliveryHash: string; cartHash: string }

export interface MerchantClient {
  card(): Promise<MerchantCard>;
  quote(req: { serviceId: string; target?: string }): Promise<CartMandate>;
  pay(req: PayRequest): Promise<PayResult>;
  deliver(req: { cart: CartMandate; txHash: Hex }): Promise<DeliverResult>;
}

export const SERVICES: Service[] = [
  { id: "wallet-snapshot", title: "Wallet snapshot", description: "HSK and USDC.e balances plus transaction count for any address on HSK Chain.", priceUsd: "0.02" },
  { id: "chain-pulse", title: "Chain pulse", description: "Latest block, timestamp and gas price on HSK Chain.", priceUsd: "0.01" },
];

// ---------- configuration ----------
export interface MerchantConfig {
  net: NetConfig; name: string; payTo: Address; relayerKey: Hex; privateKey: KeyObject; publicKeyPem: string;
}

const g = globalThis as unknown as { __mfMerchantKey?: KeyObject };

export function merchantConfigFromEnv(): MerchantConfig {
  const net = netConfig();
  let privateKey: KeyObject;
  const pem = process.env.MERCHANT_PRIVATE_KEY_PEM;
  if (pem) privateKey = loadPrivateKey(pem.replace(/\\n/g, "\n"));
  else {
    // Dev convenience only: an ephemeral key. On serverless hosts set MERCHANT_PRIVATE_KEY_PEM.
    g.__mfMerchantKey ??= generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
    privateKey = g.__mfMerchantKey;
  }
  const relayerKey = (process.env.RELAYER_KEY ?? process.env.AGENT_KEY) as Hex | undefined;
  const payTo = process.env.MERCHANT_PAY_TO as Address | undefined;
  if (!relayerKey) throw new Error("RELAYER_KEY (or AGENT_KEY) is not set");
  if (!payTo) throw new Error("MERCHANT_PAY_TO is not set");
  return { net, name: process.env.MERCHANT_NAME ?? "GROW Data Co.", payTo, relayerKey: norm(relayerKey), privateKey, publicKeyPem: publicKeyPemOf(privateKey) };
}
const norm = (k: string): Hex => (k.startsWith("0x") ? k : `0x${k}`) as Hex;

// ---------- the receiving agent's behaviour ----------
export function merchantCard(cfg: MerchantConfig): MerchantCard {
  return {
    name: cfg.name,
    description: "Receiving agent. Quotes a service as an HSP Cart Mandate and settles it against the payer's signed Payment Mandate.",
    services: SERVICES, payTo: cfg.payTo, merchantPublicKeyPem: cfg.publicKeyPem,
    network: { name: cfg.net.name, chainId: cfg.net.chainId, token: cfg.net.usdc, settler: cfg.net.settler, explorer: cfg.net.explorer },
  };
}

const rand = (n: number) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
const ADDR = /^0x[a-fA-F0-9]{40}$/;

export async function merchantQuote(cfg: MerchantConfig, req: { serviceId: string; target?: string }, now = new Date()): Promise<CartMandate> {
  const svc = SERVICES.find((s) => s.id === req.serviceId);
  if (!svc) throw new Error(`unknown service: ${req.serviceId}`);
  let label = svc.title;
  if (svc.id === "wallet-snapshot") {
    if (!req.target || !ADDR.test(req.target)) throw new Error("wallet-snapshot needs a valid 0x target address");
    label = `${svc.title} ${req.target}`;
  }
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const price = { currency: "USD", value: svc.priceUsd };
  const contents: CartContents = {
    id: `MF-${stamp}-${rand(6)}`,
    user_cart_confirmation_required: true,
    payment_request: {
      method_data: [{
        supported_methods: X402,
        data: {
          x402Version: 2,
          network: cfg.net.name === "mainnet" ? "hashkey" : cfg.net.name === "testnet" ? "hashkey-testnet" : "local",
          chain_id: cfg.net.chainId, contract_address: cfg.net.usdc, pay_to: cfg.payTo, coin: "USDC",
        },
      }],
      details: {
        id: `PR-${stamp}-${rand(6)}`,
        display_items: [{ label, amount: price }],
        total: { label: "Total", amount: price },
      },
    },
    cart_expiry: new Date(now.getTime() + 2 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    merchant_name: cfg.name,
  };
  validateCart(contents);
  return signCart(contents, cfg.privateKey, Math.floor(now.getTime() / 1000));
}

function mandateFromCart(cfg: MerchantConfig, cart: CartMandate, cartHashHex: string) {
  const { effectiveUsd } = validateCart(cart.contents);
  const m = cart.contents.payment_request.method_data[0];
  if (m.data.chain_id !== cfg.net.chainId) throw new Error("cart is for a different chain");
  if (m.data.pay_to.toLowerCase() !== cfg.payTo.toLowerCase()) throw new Error("cart payee is not this merchant");
  return {
    cartHash: `0x${cartHashHex}` as Hex,
    token: m.data.contract_address as Address,
    payee: m.data.pay_to as Address,
    amount: usdToUnits(effectiveUsd[0]),
    cartExpiry: BigInt(Math.floor(Date.parse(cart.contents.cart_expiry) / 1000)),
  };
}

export async function merchantPay(cfg: MerchantConfig, req: PayRequest): Promise<PayResult> {
  const { cartHash } = await verifyCart(req.cart, cfg.publicKeyPem); // we only settle carts we signed
  const mandate = mandateFromCart(cfg, req.cart, cartHash);
  const auth = {
    validAfter: BigInt(req.authorization.validAfter), validBefore: BigInt(req.authorization.validBefore),
    v: req.authorization.v, r: req.authorization.r, s: req.authorization.s,
  };
  const pc = publicClientFor(cfg.net);
  const wallet = walletClientFor(cfg.net, cfg.relayerKey);
  try {
    // Dry-run first: if the signature, cart, amount or payee don't line up the chain tells us why, for free.
    await pc.simulateContract({ account: wallet.account, address: cfg.net.settler, abi: settlerAbi, functionName: "settle", args: [mandate, req.payer, auth] });
  } catch (e) {
    throw new Error(`settlement would revert: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
  }
  const txHash = await wallet.writeContract({ address: cfg.net.settler, abi: settlerAbi, functionName: "settle", args: [mandate, req.payer, auth] });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("settlement transaction reverted on-chain");
  return { relayer: wallet.account.address, txHash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), simulation: "passed", explorerUrl: explorerTx(cfg.net, txHash) };
}

export async function merchantDeliver(cfg: MerchantConfig, req: { cart: CartMandate; txHash: Hex }): Promise<DeliverResult> {
  const { cartHash } = await verifyCart(req.cart, cfg.publicKeyPem);
  const mandate = mandateFromCart(cfg, req.cart, cartHash);
  const pc = publicClientFor(cfg.net);
  const receipt = await pc.getTransactionReceipt({ hash: req.txHash });
  const logs = parseEventLogs({ abi: settlerAbi, eventName: "MandateSettled", logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === cfg.net.settler.toLowerCase() && l.args.cartHash === mandate.cartHash);
  if (receipt.status !== "success" || logs.length !== 1) throw new Error("no settlement for this cart in that transaction");
  const ev = logs[0].args;
  if (ev.payee?.toLowerCase() !== mandate.payee.toLowerCase() || ev.amount !== mandate.amount) throw new Error("settled amount or payee does not match the cart");

  const label = req.cart.contents.payment_request.details.display_items?.[0]?.label ?? "";
  const svc = SERVICES.find((s) => label.startsWith(s.title));
  if (!svc) throw new Error("cart does not describe a known service");
  let result: Record<string, unknown>;
  if (svc.id === "wallet-snapshot") {
    const target = label.slice(svc.title.length + 1) as Address;
    const [hsk, usdc, txs, block] = await Promise.all([
      pc.getBalance({ address: target }),
      pc.readContract({ address: cfg.net.usdc, abi: erc20Abi, functionName: "balanceOf", args: [target] }),
      pc.getTransactionCount({ address: target }),
      pc.getBlockNumber(),
    ]);
    result = { address: target, hsk_wei: hsk.toString(), usdc_units: usdc.toString(), tx_count: txs, as_of_block: block.toString() };
  } else {
    const [block, gas] = await Promise.all([pc.getBlock(), pc.getGasPrice()]);
    result = { block: block.number.toString(), timestamp: block.timestamp.toString(), gas_price_wei: gas.toString() };
  }
  const safe = jsonSafe(result);
  return { delivered: true, serviceId: svc.id, result: safe, deliveryHash: sha256Hex(canonicalJson(safe)), cartHash: mandate.cartHash };
}

export { cartHashOf };

// ---------- clients ----------
export class InProcessMerchantClient implements MerchantClient {
  constructor(private cfg: MerchantConfig) {}
  async card() { return merchantCard(this.cfg); }
  quote(req: { serviceId: string; target?: string }) { return merchantQuote(this.cfg, req); }
  pay(req: PayRequest) { return merchantPay(this.cfg, req); }
  deliver(req: { cart: CartMandate; txHash: Hex }) { return merchantDeliver(this.cfg, req); }
}

export class HttpMerchantClient implements MerchantClient {
  constructor(private base: string) {}
  private async j<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `merchant ${path} failed (${res.status})`);
    return json as T;
  }
  card() { return this.j<MerchantCard>("/api/merchant/card"); }
  quote(req: { serviceId: string; target?: string }) { return this.j<CartMandate>("/api/merchant/quote", req); }
  pay(req: PayRequest) { return this.j<PayResult>("/api/merchant/pay", req); }
  deliver(req: { cart: CartMandate; txHash: Hex }) { return this.j<DeliverResult>("/api/merchant/deliver", req); }
}

export const derivedAddress = (key: Hex) => privateKeyToAccount(key).address;
