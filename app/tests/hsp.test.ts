import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { canonicalJson, cartHashOf, sha256Hex } from "../src/lib/hsp/canonical";
import { signCart, validateCart, verifyCart, publicKeyPemOf, usdToUnits, unitsToUsd, X402, type CartContents } from "../src/lib/hsp/cart";
import { hspHeaders, verifyWebhook } from "../src/lib/hsp/gateway";
import { createHmac } from "node:crypto";

const mk = (over: Partial<CartContents["payment_request"]["details"]> = {}): CartContents => ({
  id: "ORDER-1", user_cart_confirmation_required: true, merchant_name: "My Store", cart_expiry: "2030-01-01T00:00:00Z",
  payment_request: {
    method_data: [
      { supported_methods: X402, data: { x402Version: 2, network: "ethereum", chain_id: 1, contract_address: "0xA", pay_to: "0xR1", coin: "USDC" } },
      { supported_methods: X402, data: { x402Version: 2, network: "base", chain_id: 8453, contract_address: "0xB", pay_to: "0xR2", coin: "USDC" } },
    ],
    details: { id: "PR-1", display_items: [{ label: "Item", amount: { currency: "USD", value: "10.00" } }], total: { label: "Total", amount: { currency: "USD", value: "10.00" } }, ...over },
  },
});

describe("canonical JSON (docs example)", () => {
  it("matches the string published in the HSP docs", () => {
    const input = { merchant_name: "My Store", id: "cart-123", cart_expiry: "2024-03-01T12:00:00Z" };
    expect(canonicalJson(input)).toBe('{"cart_expiry":"2024-03-01T12:00:00Z","id":"cart-123","merchant_name":"My Store"}');
    expect(cartHashOf(input)).toHaveLength(64);
  });
});

describe("cart validation (rules from the HSP docs)", () => {
  it("applies a modifier only to the indexes it names (10.00 vs 11.00)", () => {
    const c = mk({ modifiers: [{ supported_methods: X402, data: { method_data_indexes: [1] }, additional_display_items: [{ label: "fee", amount: { currency: "USD", value: "1.00" } }], total: { label: "Due", amount: { currency: "USD", value: "11.00" } } }] });
    expect(validateCart(c).effectiveUsd).toEqual(["10.00", "11.00"]);
  });
  it("rejects a modifier total that does not add up", () => {
    const c = mk({ modifiers: [{ supported_methods: X402, additional_display_items: [{ label: "fee", amount: { currency: "USD", value: "1.00" } }], total: { label: "Due", amount: { currency: "USD", value: "12.00" } } }] });
    expect(() => validateCart(c)).toThrow(/modifier.total/);
  });
  it("rejects display_items that do not sum to total, non-USD and duplicate index matches", () => {
    expect(() => validateCart(mk({ total: { label: "T", amount: { currency: "USD", value: "9.00" } } }))).toThrow(/sum/);
    expect(() => validateCart(mk({ total: { label: "T", amount: { currency: "EUR", value: "10.00" } } }))).toThrow(/USD/);
    const mod = { supported_methods: X402, data: { method_data_indexes: [0] }, additional_display_items: [{ label: "a", amount: { currency: "USD", value: "1.00" } }] };
    expect(() => validateCart(mk({ modifiers: [mod, mod] }))).toThrow(/two modifiers/);
  });
  it("converts decimals without floating point", () => {
    expect(usdToUnits("0.02")).toBe(20000n);
    expect(usdToUnits("10")).toBe(10_000_000n);
    expect(unitsToUsd(20000n)).toBe("0.02");
    expect(() => usdToUnits("0.0000001")).toThrow();
  });
});

describe("merchant_authorization (ES256K)", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const pub = publicKeyPemOf(privateKey);
  it("verifies, and rejects a tampered cart or the wrong key", async () => {
    const cart = await signCart(mk(), privateKey);
    expect((await verifyCart(cart, pub)).cartHash).toBe(cartHashOf(cart.contents));
    const tampered = { ...cart, contents: { ...cart.contents, merchant_name: "Evil" } };
    await expect(verifyCart(tampered, pub)).rejects.toThrow(/cart_hash/);
    const other = publicKeyPemOf(generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey);
    await expect(verifyCart(cart, other)).rejects.toThrow(/invalid/);
  });
});

describe("HSP HMAC request signing", () => {
  it("equals the docs' openssl pipeline for POST and GET", () => {
    const secret = "s3cret", ts = 1709123456, nonce = "a3f1b2c4d5e6";
    const body = { cart_mandate: { a: 1 } };
    const post = hspHeaders({ appKey: "ak", appSecret: secret, method: "POST", path: "/api/v1/merchant/orders", body, timestamp: ts, nonce });
    const bodyHash = sha256Hex(canonicalJson(body));
    const msg = `POST\n/api/v1/merchant/orders\n\n${bodyHash}\n${ts}\n${nonce}`;
    const viaOpenssl = execSync(`printf "%b" "${msg.replace(/\n/g, "\\n")}" | openssl dgst -sha256 -hmac "${secret}" -hex | awk '{print $NF}'`).toString().trim();
    expect(post["X-Signature"]).toBe(viaOpenssl);
    const get = hspHeaders({ appKey: "ak", appSecret: secret, method: "GET", path: "/api/v1/merchant/payments", query: "cart_mandate_id=ORDER-123", timestamp: ts, nonce });
    const gmsg = `GET\n/api/v1/merchant/payments\ncart_mandate_id=ORDER-123\n\n${ts}\n${nonce}`;
    const g2 = execSync(`printf "%b" "${gmsg.replace(/\n/g, "\\n")}" | openssl dgst -sha256 -hmac "${secret}" -hex | awk '{print $NF}'`).toString().trim();
    expect(get["X-Signature"]).toBe(g2);
  });
  it("verifies webhook signatures and rejects stale or forged ones", () => {
    const raw = '{"status":"payment-finalized"}', t = 1_800_000_000, secret = "wh";
    const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    expect(verifyWebhook({ secret, header: `t=${t},v1=${v1}`, rawBody: raw, now: t + 10 })).toBe(true);
    expect(verifyWebhook({ secret, header: `t=${t},v1=${v1}`, rawBody: raw, now: t + 1000 })).toBe(false);
    expect(verifyWebhook({ secret, header: `t=${t},v1=${"0".repeat(64)}`, rawBody: raw, now: t })).toBe(false);
  });
});
