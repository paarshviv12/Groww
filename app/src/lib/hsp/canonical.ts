import { createHash } from "node:crypto";

/** Recursively sort object keys (HSP "Canonical JSON", RFC 8785 style, compact). */
export function sortKeys(val: unknown): unknown {
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(val as object).sort()) out[k] = sortKeys((val as Record<string, unknown>)[k]);
  return out;
}

export const canonicalJson = (val: unknown): string => JSON.stringify(sortKeys(val));

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** cart_hash = SHA-256(canonicalJson(cart_mandate.contents)) as 64 lowercase hex chars. */
export const cartHashOf = (contents: unknown): string => sha256Hex(canonicalJson(contents));
