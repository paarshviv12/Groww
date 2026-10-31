import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCart, decodeCart, describeCart, encodeCart, type Issuer } from "../src/lib/v1";
import { publicKeyPemOf } from "../src/lib/hsp/cart";
import { netConfig } from "../src/lib/chain";

const privateKey = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
const iss: Issuer = {
  net: { ...netConfig("local"), settler: "0x5fbdb2315678afecb367f032d93f642f64180aa3", usdc: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" },
  privateKey, publicKeyPem: publicKeyPemOf(privateKey), relayerKey: "0x01", maxCartUsd: "1000", minCartUsd: "0.01",
};
const PAYEE = "0x1111111111111111111111111111111111111111";

describe("GROWW v1 carts", () => {
  it("creates a signed cart and describes it as valid", async () => {
    const cart = await createCart(iss, { payTo: PAYEE, amountUsd: "12.5", description: "Logo", merchantName: "Acme" });
    const v = await describeCart(iss, cart);
    expect(v.valid).toBe(true);
    expect(v.amountUsd).toBe("12.50");
    expect(v.payTo).toBe(PAYEE);
    expect(v.merchantName).toBe("Acme");
    expect(v.expired).toBe(false);
  });
  it("survives the pay-link round trip", async () => {
    const cart = await createCart(iss, { payTo: PAYEE, amountUsd: "1" });
    expect(decodeCart(encodeCart(cart))).toEqual(cart);
  });
  it("rejects a cart whose payee was changed after signing", async () => {
    const cart = await createCart(iss, { payTo: PAYEE, amountUsd: "1" });
    cart.contents.payment_request.method_data[0].data.pay_to = "0x2222222222222222222222222222222222222222";
    expect((await describeCart(iss, cart)).valid).toBe(false);
  });
  it("rejects a cart whose amount was changed after signing", async () => {
    const cart = await createCart(iss, { payTo: PAYEE, amountUsd: "1" });
    cart.contents.payment_request.details.total.amount.value = "0.01";
    cart.contents.payment_request.details.display_items![0].amount.value = "0.01";
    expect((await describeCart(iss, cart)).valid).toBe(false);
  });
  it("rejects a cart signed by a different key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey;
    const cart = await createCart({ ...iss, privateKey: other }, { payTo: PAYEE, amountUsd: "1" });
    expect((await describeCart(iss, cart)).valid).toBe(false);
  });
  it("enforces limits and address checks", async () => {
    await expect(createCart(iss, { payTo: "nope", amountUsd: "1" })).rejects.toThrow(/wallet address/);
    await expect(createCart(iss, { payTo: iss.net.settler, amountUsd: "1" })).rejects.toThrow(/cannot/);
    await expect(createCart(iss, { payTo: PAYEE, amountUsd: "0.001" })).rejects.toThrow(/at least/);
    await expect(createCart(iss, { payTo: PAYEE, amountUsd: "5000" })).rejects.toThrow(/at most/);
    await expect(createCart(iss, { payTo: PAYEE, amountUsd: "1.1234567" })).rejects.toThrow();
  });
  it("sums several items into the total", async () => {
    const cart = await createCart(iss, { payTo: PAYEE, items: [{ label: "A", amountUsd: "1.10" }, { label: "B", amountUsd: "2.20" }] });
    expect((await describeCart(iss, cart)).amountUsd).toBe("3.30");
  });
  it("marks an expired cart as expired", async () => {
    const cart = await createCart(iss, { payTo: PAYEE, amountUsd: "1", expiresInMinutes: 5 }, new Date(Date.now() - 3 * 3600 * 1000));
    const v = await describeCart(iss, cart);
    expect(v.expired).toBe(true);
  });
});
