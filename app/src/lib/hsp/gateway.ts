import { createHmac, randomBytes } from "node:crypto";
import { canonicalJson, sha256Hex } from "./canonical";
import type { CartMandate } from "./cart";

/** Hosts from the HSP docs. */
export const HSP_HOSTS = {
  qa: "https://merchant-qa.hashkeymerchant.com", // testnet tokens
  staging: "https://merchant-stg.hashkeymerchant.com", // mainnet tokens
  production: "https://hsp.hashkey.com", // mainnet tokens
} as const;

export type HspPaymentStatus =
  | "payment-required" | "payment-submitted" | "payment-verified" | "payment-processing"
  | "payment-included" | "payment-safe" | "payment-finalized" | "payment-failed";

export const HSP_TERMINAL: HspPaymentStatus[] = ["payment-finalized", "payment-failed"];

/**
 * HMAC-SHA256 request signing exactly as documented:
 *   message = "{METHOD}\n{PATH}\n{QUERY}\n{bodyHash}\n{timestamp}\n{nonce}"
 *   bodyHash = hex(sha256(canonicalJson(body))), or "" when there is no body
 *   signature = hex(HMAC-SHA256(app_secret, message))
 */
export function hspHeaders(opts: {
  appKey: string; appSecret: string; method: "GET" | "POST"; path: string; query?: string; body?: unknown;
  timestamp?: number; nonce?: string;
}): Record<string, string> {
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const bodyHash = opts.body === undefined ? "" : sha256Hex(canonicalJson(opts.body));
  const message = `${opts.method}\n${opts.path}\n${opts.query ?? ""}\n${bodyHash}\n${ts}\n${nonce}`;
  const signature = createHmac("sha256", opts.appSecret).update(message).digest("hex");
  return { "X-App-Key": opts.appKey, "X-Timestamp": ts, "X-Nonce": nonce, "X-Signature": signature, "Content-Type": "application/json" };
}

export interface HspCreds { appKey: string; appSecret: string; host: string }

export function hspCredsFromEnv(): HspCreds | null {
  const appKey = process.env.HSP_APP_KEY, appSecret = process.env.HSP_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret, host: process.env.HSP_HOST || HSP_HOSTS.production };
}

async function call<T>(c: HspCreds, method: "GET" | "POST", path: string, query: string, body?: unknown): Promise<T> {
  const headers = hspHeaders({ appKey: c.appKey, appSecret: c.appSecret, method, path, query, body });
  // The body must be sent as the same canonical string that was hashed.
  const res = await fetch(`${c.host}${path}${query ? `?${query}` : ""}`, {
    method, headers, body: body === undefined ? undefined : canonicalJson(body),
  });
  const json = (await res.json()) as { code: number; msg: string; data: T };
  if (json.code !== 0) throw new Error(`HSP ${path} failed: code ${json.code} ${json.msg}`);
  return json.data;
}

export interface CreatedOrder { payment_request_id: string; payment_url: string; multi_pay: boolean }

/** POST /api/v1/merchant/orders - creates a one-time order from a signed Cart Mandate. */
export const createOrder = (c: HspCreds, cart: CartMandate, redirectUrl?: string) =>
  call<CreatedOrder>(c, "POST", "/api/v1/merchant/orders", "", { cart_mandate: cart, ...(redirectUrl ? { redirect_url: redirectUrl } : {}) });

export interface PaymentRecord {
  status: HspPaymentStatus; flow_id: string; payment_request_id: string; content_id: string;
  tx_signature?: string; payer_address?: string; to_pay_address?: string; token?: string; pay_amount?: string; status_reason?: string | null;
}

/** GET /api/v1/merchant/payments?payment_request_id=... */
export const queryPayment = (c: HspCreds, paymentRequestId: string) =>
  call<PaymentRecord>(c, "GET", "/api/v1/merchant/payments", `payment_request_id=${encodeURIComponent(paymentRequestId)}`);

/** Webhook verification: header `X-Signature: t=<unix>,v1=<hex>`; docs specify HMAC-SHA256 with a 300 s tolerance. */
export function verifyWebhook(opts: { secret: string; header: string; rawBody: string; now?: number; toleranceSec?: number }): boolean {
  const parts = Object.fromEntries(opts.header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t), v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs((opts.now ?? Math.floor(Date.now() / 1000)) - t) > (opts.toleranceSec ?? 300)) return false;
  const expected = createHmac("sha256", opts.secret).update(`${t}.${opts.rawBody}`).digest("hex");
  return expected.length === v1.length && expected === v1;
}
