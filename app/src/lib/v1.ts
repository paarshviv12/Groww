import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { parseAbiItem, type Address, type Hex } from "viem";
import { settlerAbi } from "./generated/settler";
import { explorerTx, netConfig, publicClientFor, revertReason, walletClientFor, type NetConfig } from "./chain";
import { cartHashOf } from "./hsp/canonical";
import {
  X402, loadPrivateKey, publicKeyPemOf, signCart, unitsToUsd, usdToUnits, validateCart, verifyCart,
  type CartContents, type CartMandate,
} from "./hsp/cart";

/**
 * GROWW v1: a stateless agent-payments API.
 *  - A cart is a signed HSP Cart Mandate. Its "id" is its cart hash. No database is involved.
 *  - Whether a cart is paid is read from the settlement contract, never from our own records.
 */

export const ADDR = /^0x[a-fA-F0-9]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface Issuer { net: NetConfig; privateKey: KeyObject; publicKeyPem: string; relayerKey: Hex; maxCartUsd: string; minCartUsd: string }

const g = globalThis as unknown as { __gwKey?: KeyObject };

export function issuerFromEnv(): Issuer {
  const net = netConfig();
  let privateKey: KeyObject;
  const pem = process.env.MERCHANT_PRIVATE_KEY_PEM;
  if (pem) privateKey = loadPrivateKey(pem.replace(/\\n/g, "\n"));
  else {
    // Dev only. On a real host set MERCHANT_PRIVATE_KEY_PEM so carts stay valid across restarts.
    g.__gwKey ??= generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
    privateKey = g.__gwKey;
  }
  const rk = (process.env.RELAYER_KEY ?? process.env.AGENT_KEY) as string | undefined;
  if (!rk) throw new Error("RELAYER_KEY (or AGENT_KEY) is not set");
  return {
    net, privateKey, publicKeyPem: publicKeyPemOf(privateKey),
    relayerKey: (rk.startsWith("0x") ? rk : `0x${rk}`) as Hex,
    maxCartUsd: process.env.MAX_CART_USD ?? "1000", minCartUsd: process.env.MIN_CART_USD ?? "0.01",
  };
}

// ---------- tiny in-memory rate limiter (per server instance) ----------
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const k of hits.keys()) { if (!(hits.get(k) ?? []).some((t) => now - t < windowMs)) hits.delete(k); }
  return true;
}
export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";

// ---------- cart token (the pay link carries the whole signed cart) ----------
export const encodeCart = (cart: CartMandate): string => Buffer.from(JSON.stringify(cart)).toString("base64url");
export function decodeCart(token: string): CartMandate {
  try {
    const cart = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as CartMandate;
    if (!cart?.contents || !cart.merchant_authorization) throw new Error("bad");
    return cart;
  } catch { throw new Error("That cart link is not valid."); }
}

export function publicOrigin(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

// ---------- create ----------
export interface CreateCartInput {
  payTo: string; amountUsd?: string; items?: { label: string; amountUsd: string }[];
  description?: string; merchantName?: string; expiresInMinutes?: number;
}

const rand = (n: number) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export async function createCart(iss: Issuer, input: CreateCartInput, now = new Date()): Promise<CartMandate> {
  if (!ADDR.test(input.payTo ?? "")) throw new Error("payTo must be a 0x wallet address");
  const payTo = input.payTo.toLowerCase();
  if (payTo === ZERO || payTo === iss.net.settler.toLowerCase() || payTo === iss.net.usdc.toLowerCase()) throw new Error("payTo cannot be that address");

  let items: { label: string; amount: string }[];
  if (input.items?.length) {
    if (input.items.length > 20) throw new Error("at most 20 items per cart");
    items = input.items.map((i) => ({ label: clean(String(i.label ?? ""), 80) || "Item", amount: String(i.amountUsd) }));
  } else {
    if (!input.amountUsd) throw new Error("amountUsd is required");
    items = [{ label: clean(input.description ?? "", 120) || "Payment", amount: String(input.amountUsd) }];
  }
  const units = items.map((i) => usdToUnits(i.amount)); // throws on bad decimals
  const total = units.reduce((a, b) => a + b, 0n);
  if (total < usdToUnits(iss.minCartUsd)) throw new Error(`amount must be at least $${iss.minCartUsd}`);
  if (total > usdToUnits(iss.maxCartUsd)) throw new Error(`amount must be at most $${iss.maxCartUsd}`);

  const mins = Math.min(Math.max(Math.floor(input.expiresInMinutes ?? 120), 5), 7 * 24 * 60);
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const money = (u: bigint) => ({ currency: "USD", value: unitsToUsd(u) });
  const contents: CartContents = {
    id: `GW-${stamp}-${rand(6)}`,
    user_cart_confirmation_required: true,
    payment_request: {
      method_data: [{
        supported_methods: X402,
        data: {
          x402Version: 2,
          network: iss.net.name === "mainnet" ? "hashkey" : iss.net.name === "testnet" ? "hashkey-testnet" : "local",
          chain_id: iss.net.chainId, contract_address: iss.net.usdc, pay_to: input.payTo, coin: "USDC",
        },
      }],
      details: {
        id: `PR-${stamp}-${rand(6)}`,
        display_items: items.map((i, k) => ({ label: i.label, amount: money(units[k]) })),
        total: { label: "Total", amount: money(total) },
      },
    },
    cart_expiry: new Date(now.getTime() + mins * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    merchant_name: clean(input.merchantName ?? "", 60) || "GROWW merchant",
  };
  validateCart(contents);
  return signCart(contents, iss.privateKey, Math.floor(now.getTime() / 1000));
}

// ---------- verify / describe ----------
export interface CartView {
  cartHash: string; valid: boolean; error?: string; expired: boolean; expiresAt?: string; merchantName?: string;
  payTo?: string; amountUsd?: string; description?: string; chainId?: number; token?: string;
}

export async function describeCart(iss: Issuer, cart: CartMandate): Promise<CartView> {
  const cartHash = cartHashOf(cart.contents);
  try {
    // The signature is valid for a week of cart lifetime, not just the first hour: the JWT is only a signature carrier here.
    const claims = await verifyCartLoose(cart, iss.publicKeyPem);
    if (claims !== cartHash) throw new Error("cart hash mismatch");
    const { effectiveUsd } = validateCart(cart.contents);
    const m = cart.contents.payment_request.method_data[0].data;
    if (m.chain_id !== iss.net.chainId) throw new Error("this cart is for a different network");
    return {
      cartHash, valid: true, expired: Date.parse(cart.contents.cart_expiry) <= Date.now(), expiresAt: cart.contents.cart_expiry,
      merchantName: cart.contents.merchant_name, payTo: m.pay_to, amountUsd: effectiveUsd[0],
      description: cart.contents.payment_request.details.display_items?.map((i) => i.label).join(", "),
      chainId: m.chain_id, token: m.contract_address,
    };
  } catch (e) { return { cartHash, valid: false, error: (e as Error).message, expired: false }; }
}

/** Checks the ES256K signature and returns the signed cart hash. The JWT's own 1h expiry is ignored; cart_expiry governs. */
async function verifyCartLoose(cart: CartMandate, pem: string): Promise<string> {
  try { return (await verifyCart(cart, pem)).cartHash; }
  catch (e) {
    if (!/expired/.test((e as Error).message)) throw e;
    // re-verify with a clock inside the token's window by re-checking only the signature
    const { createPublicKey, verify } = await import("node:crypto");
    const [h, b, s] = cart.merchant_authorization.split(".");
    const ok = verify("sha256", Buffer.from(`${h}.${b}`), { key: createPublicKey(pem), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    if (!ok) throw new Error("merchant signature is invalid");
    const claims = JSON.parse(Buffer.from(b, "base64url").toString()) as { cart_hash?: string };
    if (claims.cart_hash !== cartHashOf(cart.contents)) throw new Error("cart_hash in merchant_authorization does not match the cart contents");
    return claims.cart_hash;
  }
}

// ---------- status (read from chain) ----------
const settledEvent = parseAbiItem("event MandateSettled(bytes32 indexed cartHash, address indexed payer, address indexed payee, address token, uint256 amount, bytes32 authNonce)");
const fromBlock = () => BigInt(process.env.SETTLER_FROM_BLOCK ?? "0");

export interface Settlement { payer: string; payee: string; amountUsd: string; token: string; txHash?: string; block?: string; explorerUrl?: string; settledAt?: string }

async function logsChunked(net: NetConfig, args: { cartHash?: Hex; payee?: Address }, maxBlocks = 200_000n): Promise<Awaited<ReturnType<ReturnType<typeof publicClientFor>["getLogs"]>>> {
  const pc = publicClientFor(net);
  const head = await pc.getBlockNumber();
  let start = fromBlock();
  if (start === 0n && head > maxBlocks) start = head - maxBlocks;
  const out: Awaited<ReturnType<typeof pc.getLogs>> = [];
  const step = 50_000n;
  for (let from = start; from <= head; from += step) {
    const to = from + step - 1n > head ? head : from + step - 1n;
    const part = await pc.getLogs({ address: net.settler, event: settledEvent, args, fromBlock: from, toBlock: to });
    out.push(...part);
  }
  return out;
}

export async function cartStatus(iss: Issuer, cartHashHex: Hex): Promise<{ status: "settled" | "unpaid"; settlement?: Settlement }> {
  const pc = publicClientFor(iss.net);
  const r = (await pc.readContract({ address: iss.net.settler, abi: settlerAbi, functionName: "receipts", args: [cartHashHex] })) as readonly [Address, Address, Address, bigint, bigint, Hex];
  if (r[0].toLowerCase() === ZERO) return { status: "unpaid" };
  const settlement: Settlement = { payer: r[0], payee: r[1], token: r[2], amountUsd: unitsToUsd(r[3]), settledAt: new Date(Number(r[4]) * 1000).toISOString() };
  try {
    const logs = await logsChunked(iss.net, { cartHash: cartHashHex });
    const l = logs[0];
    if (l?.transactionHash) {
      settlement.txHash = l.transactionHash; settlement.block = l.blockNumber?.toString();
      settlement.explorerUrl = explorerTx(iss.net, l.transactionHash) || undefined;
    }
  } catch { /* the receipt itself is already proof; the tx link is a convenience */ }
  return { status: "settled", settlement };
}

export async function paymentsTo(iss: Issuer, payee: Address, limit = 25): Promise<(Settlement & { cartHash: string })[]> {
  const logs = (await logsChunked(iss.net, { payee })) as unknown as { args: { cartHash: Hex; payer: Address; payee: Address; token: Address; amount: bigint }; transactionHash: Hex; blockNumber: bigint }[];
  const latest = logs.slice(-limit).reverse();
  const pc = publicClientFor(iss.net);
  return Promise.all(latest.map(async (l) => {
    let settledAt: string | undefined;
    try { settledAt = new Date(Number((await pc.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000).toISOString(); } catch { /* optional */ }
    return {
      cartHash: l.args.cartHash, payer: l.args.payer, payee: l.args.payee, token: l.args.token, amountUsd: unitsToUsd(l.args.amount),
      txHash: l.transactionHash, block: l.blockNumber.toString(), explorerUrl: explorerTx(iss.net, l.transactionHash) || undefined, settledAt,
    };
  }));
}

// ---------- settle (relay) ----------
export interface SettleInput { cart: CartMandate; payer: Address; authorization: { validAfter: string; validBefore: string; v: number; r: Hex; s: Hex } }
const inflight = new Set<string>();

export async function settleCart(iss: Issuer, req: SettleInput) {
  const cartHash = cartHashOf(req.cart.contents);
  const view = await describeCart(iss, req.cart);
  if (!view.valid) throw new Error(`cart rejected: ${view.error}`);
  if (view.expired) throw new Error("this cart has expired");
  if (!ADDR.test(req.payer)) throw new Error("payer must be a 0x address");
  const m = req.cart.contents.payment_request.method_data[0].data;
  const mandate = {
    cartHash: `0x${cartHash}` as Hex, token: m.contract_address as Address, payee: m.pay_to as Address,
    amount: usdToUnits(view.amountUsd!), cartExpiry: BigInt(Math.floor(Date.parse(req.cart.contents.cart_expiry) / 1000)),
  };
  const auth = {
    validAfter: BigInt(req.authorization.validAfter), validBefore: BigInt(req.authorization.validBefore),
    v: Number(req.authorization.v), r: req.authorization.r, s: req.authorization.s,
  };
  if (inflight.has(cartHash)) throw new Error("this cart is already being settled");
  inflight.add(cartHash);
  try {
    const pc = publicClientFor(iss.net);
    const wallet = walletClientFor(iss.net, iss.relayerKey);
    try {
      await pc.simulateContract({ account: wallet.account, address: iss.net.settler, abi: settlerAbi, functionName: "settle", args: [mandate, req.payer, auth] });
    } catch (e) { throw new Error(`settlement would revert: ${revertReason(e)}`); }
    const txHash = await wallet.writeContract({ address: iss.net.settler, abi: settlerAbi, functionName: "settle", args: [mandate, req.payer, auth] });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("settlement transaction reverted on-chain");
    return { cartHash, txHash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), explorerUrl: explorerTx(iss.net, txHash) };
  } finally { inflight.delete(cartHash); }
}
