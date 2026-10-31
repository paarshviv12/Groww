// GROWW SDK. Works in Node 20+ and any modern runtime with fetch.
//
//   import { Groww } from "groww-sdk";
//   const groww = new Groww({ api: "https://your-groww.onrender.com" });
//   const { payUrl, id } = await groww.createCart({ payTo: "0x…", amountUsd: "1.50", description: "Report" });
//   const result = await groww.pay(payUrl, { privateKey: process.env.GROWW_KEY, maxUsd: "5" });
//   const state = await groww.status(id);       // read from the chain
//
import { createHash } from "node:crypto";
import { encodeAbiParameters, keccak256, parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const sortKeys = (v) => (v === null || typeof v !== "object" ? v : Array.isArray(v) ? v.map(sortKeys)
  : Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])));
export const cartHashOf = (contents) => createHash("sha256").update(JSON.stringify(sortKeys(contents)), "utf8").digest("hex");

export const usdToUnits = (s) => {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
  if (!m) throw new Error(`not a decimal amount: ${s}`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0").slice(0, 6) || "0");
};

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
};

export class Groww {
  constructor({ api }) {
    if (!api) throw new Error("Groww({ api }) needs the base URL of a GROWW server");
    this.api = api.replace(/\/$/, "").replace(/\/api\/v1$/, "");
  }

  async #j(path, body) {
    const res = await fetch(`${this.api}/api/v1${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `GROWW ${path} failed (${res.status})`);
    return json;
  }

  config() { return this.#j("/config"); }

  /** Create a signed cart that pays `payTo`. Returns { id, cart, payUrl, statusUrl, expiresAt }. */
  createCart({ payTo, amountUsd, items, description, merchantName, expiresInMinutes }) {
    return this.#j("/carts", { payTo, amountUsd, items, description, merchantName, expiresInMinutes });
  }

  /** Is the cart paid? Read from the settlement contract. `idOrUrl` can be a cart hash. */
  status(id) { return this.#j(`/carts/${id}`); }

  /** Payments settled to an address. */
  payments(payee, limit = 25) { return this.#j(`/payments?payee=${payee}&limit=${limit}`); }

  /** Accepts a pay link, a cart token, or a cart object. */
  static cartFrom(input) {
    if (typeof input === "object") return input;
    const token = String(input).split("/pay/").pop().split(/[?#]/)[0];
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  }

  /**
   * Pay a cart. The agent checks the cart against its own policy first, signs ONE EIP-3009 authorisation
   * whose nonce binds the cart hash and payee, and GROWW relays it (no gas needed).
   * policy: { maxUsd, minMinutesBeforeExpiry, allowPayTo: [addresses] }
   */
  async pay(cartInput, { privateKey, maxUsd = "1", minMinutesBeforeExpiry = 2, allowPayTo, dryRun = false } = {}) {
    if (!privateKey) throw new Error("pay() needs { privateKey }");
    const cart = Groww.cartFrom(cartInput);
    const [cfg, view] = await Promise.all([this.config(), this.#j("/verify", { cart })]);
    if (!view.valid) throw new Error(`cart refused: ${view.error}`);
    if (view.status === "settled") throw new Error("cart is already paid");
    if (view.expired) throw new Error("cart has expired");

    const hash = cartHashOf(cart.contents);
    if (hash !== view.cartHash) throw new Error("server and client disagree on the cart hash");
    const m = cart.contents.payment_request.method_data[0].data;
    const amount = usdToUnits(view.amountUsd);
    const checks = [
      ["right network", m.chain_id === cfg.chainId],
      ["right token", m.contract_address.toLowerCase() === cfg.token.toLowerCase()],
      [`amount $${view.amountUsd} within $${maxUsd} limit`, amount <= usdToUnits(maxUsd)],
      ["not about to expire", Date.parse(cart.contents.cart_expiry) - Date.now() > minMinutesBeforeExpiry * 60_000],
      ["payee allowed", !allowPayTo || allowPayTo.map((a) => a.toLowerCase()).includes(m.pay_to.toLowerCase())],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([c]) => c);
    if (bad.length) throw new Error(`policy refused: ${bad.join("; ")}`);

    const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
    const nonce = keccak256(encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }],
      ["GROWW.v1", BigInt(cfg.chainId), cfg.settler, `0x${hash}`, m.pay_to],
    ));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
    const signature = await account.signTypedData({
      domain: cfg.domain, types: RECEIVE_TYPES, primaryType: "ReceiveWithAuthorization",
      message: { from: account.address, to: cfg.settler, value: amount, validAfter: 0n, validBefore, nonce },
    });
    const p = parseSignature(signature);
    const authorization = { validAfter: "0", validBefore: validBefore.toString(), v: Number(p.v ?? BigInt(27 + (p.yParity ?? 0))), r: p.r, s: p.s };
    if (dryRun) return { dryRun: true, payer: account.address, cartHash: hash, amountUsd: view.amountUsd, payTo: m.pay_to, authorization };

    const paid = await this.#j(`/carts/${hash}/settle`, { cart, payer: account.address, authorization });
    const state = await this.status(hash); // the chain's own answer, not ours
    if (state.status !== "settled") throw new Error("settlement was sent but the contract has no receipt for this cart");
    return { ok: true, payer: account.address, cartHash: hash, amountUsd: view.amountUsd, payTo: m.pay_to, txHash: paid.txHash, explorerUrl: paid.explorerUrl, receipt: state.settlement };
  }
}
