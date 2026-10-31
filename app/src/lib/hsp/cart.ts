import { createPrivateKey, createPublicKey, randomBytes, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";
import { cartHashOf } from "./canonical";

export const X402 = "https://www.x402.org/";
export const HSP_AUDIENCE = "HashkeyMerchant";

export type Money = { currency: string; value: string };
export type Labeled = { label: string; amount: Money };

export interface MethodData {
  supported_methods: string;
  data: { x402Version: number; network: string; chain_id: number; contract_address: string; pay_to: string; coin: string };
}
export interface Modifier {
  supported_methods: string;
  data?: { method_data_indexes?: number[] };
  additional_display_items: Labeled[];
  total?: Labeled;
}
export interface CartContents {
  id: string;
  user_cart_confirmation_required: boolean;
  payment_request: {
    method_data: MethodData[];
    details: { id: string; display_items?: Labeled[]; total: Labeled; modifiers?: Modifier[] };
  };
  cart_expiry: string; // RFC 3339
  merchant_name: string;
}
export interface CartMandate {
  contents: CartContents;
  merchant_authorization: string;
}

// ---------- decimal helpers (no floating point) ----------
export function usdToUnits(value: string, decimals = 6): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal amount: ${value}`);
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) throw new Error(`too many decimals: ${value}`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals) || "0");
}
export function unitsToUsd(units: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${frac}`;
}

const normMethod = (s: string) => s.trim().replace(/\/$/, "");

/** Enforces the Cart Mandate rules from the HSP docs; returns the effective USD total per method_data entry. */
export function validateCart(c: CartContents): { effectiveUsd: string[] } {
  const req = c.payment_request;
  if (!c.id || !c.merchant_name) throw new Error("cart needs id and merchant_name");
  if (!req.method_data.length) throw new Error("method_data must have at least one entry");
  for (const m of req.method_data) {
    if (normMethod(m.supported_methods) !== normMethod(X402)) throw new Error("unsupported payment method");
    if (m.data.x402Version !== 2) throw new Error("x402Version must be 2");
  }
  const d = req.details;
  const all = [d.total, ...(d.display_items ?? []), ...(d.modifiers ?? []).flatMap((m) => [...m.additional_display_items, ...(m.total ? [m.total] : [])])];
  if (all.some((x) => x.amount.currency !== "USD")) throw new Error("all amounts must be USD");
  const totalU = usdToUnits(d.total.amount.value);
  if (d.display_items?.length) {
    const sum = d.display_items.reduce((a, i) => a + usdToUnits(i.amount.value), 0n);
    if (sum !== totalU) throw new Error("display_items must sum to details.total");
  }
  const eff: bigint[] = req.method_data.map(() => totalU);
  const claimed = new Set<number>();
  for (const mod of d.modifiers ?? []) {
    if (!mod.additional_display_items.length) throw new Error("additional_display_items must be non-empty");
    const idx = mod.data?.method_data_indexes ?? req.method_data.map((m, i) => (normMethod(m.supported_methods) === normMethod(mod.supported_methods) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) throw new Error("modifier matches no method_data");
    for (const i of idx) {
      if (!Number.isInteger(i) || i < 0 || i >= req.method_data.length) throw new Error("modifier index out of range");
      if (claimed.has(i)) throw new Error("method_data index matched by two modifiers");
      claimed.add(i);
    }
    if (mod.total) {
      const mt = usdToUnits(mod.total.amount.value);
      const expect = totalU + mod.additional_display_items.reduce((a, i) => a + usdToUnits(i.amount.value), 0n);
      if (mt <= 0n || mt !== expect) throw new Error("modifier.total must equal details.total + additional items");
      for (const i of idx) eff[i] = mt;
    }
  }
  return { effectiveUsd: eff.map((u) => unitsToUsd(u)) };
}

// ---------- merchant_authorization (ES256K JWT) ----------
// ES256K = ECDSA over secp256k1 with SHA-256, signature as raw r||s (IEEE P1363) per RFC 8812.
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export const loadPrivateKey = (pem: string): KeyObject => createPrivateKey(pem);
export const publicKeyPemOf = (priv: KeyObject): string => createPublicKey(priv).export({ type: "spki", format: "pem" }).toString();

export function signJwtES256K(claims: Record<string, unknown>, key: KeyObject): string {
  const head = b64u(JSON.stringify({ alg: "ES256K", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = nodeSign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64u(sig)}`;
}

export function verifyJwtES256K(jwt: string, publicKeyPem: string, opts: { audience: string; now?: number }): Record<string, unknown> {
  const [h, b, s] = jwt.split(".");
  if (!h || !b || !s) throw new Error("malformed merchant_authorization");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  if (header.alg !== "ES256K") throw new Error("merchant_authorization must be ES256K");
  const ok = nodeVerify("sha256", Buffer.from(`${h}.${b}`), { key: createPublicKey(publicKeyPem), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("merchant signature is invalid");
  const claims = JSON.parse(Buffer.from(b, "base64url").toString()) as Record<string, unknown>;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (claims.aud !== opts.audience) throw new Error("merchant_authorization audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp < now) throw new Error("merchant_authorization expired");
  return claims;
}

export async function signCart(contents: CartContents, key: KeyObject, now = Math.floor(Date.now() / 1000)): Promise<CartMandate> {
  const jwt = signJwtES256K(
    {
      iss: contents.merchant_name, sub: contents.merchant_name, aud: HSP_AUDIENCE,
      iat: now, exp: now + 3600, jti: `JWT-${now}-${randomBytes(4).toString("hex")}`, cart_hash: cartHashOf(contents),
    },
    key,
  );
  return { contents, merchant_authorization: jwt };
}

/** Verifies the merchant signature AND that the signed hash matches the cart the payer is looking at. */
export async function verifyCart(cart: CartMandate, merchantPublicKeyPem: string): Promise<{ cartHash: string; issuer: string }> {
  const claims = verifyJwtES256K(cart.merchant_authorization, merchantPublicKeyPem, { audience: HSP_AUDIENCE });
  const actual = cartHashOf(cart.contents);
  if (claims.cart_hash !== actual) throw new Error("cart_hash in merchant_authorization does not match the cart contents");
  return { cartHash: actual, issuer: String(claims.iss) };
}
