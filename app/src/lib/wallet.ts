"use client";
import { createPublicClient, createWalletClient, custom, encodeAbiParameters, keccak256, parseSignature, type Address, type Hex } from "viem";

export type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
export interface ChainCfg {
  network: string; chainId: number; settler: string; token: string; rpc: string; explorer: string;
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
}

export const getEth = (): Eip1193 | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eip1193 }).ethereum);
export const chainLabel = (id: number) => (id === 177 ? "HashKey Chain" : id === 133 ? "HashKey Chain Testnet" : "Local test chain");
export const short = (a: string, n = 6) => (a && a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a);
export const unitsOf = (usd: string) => { const [d, f = ""] = usd.split("."); return BigInt(d || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6)); };

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Ask the wallet for an account and put it on the right network. */
export async function connectWallet(cfg: ChainCfg): Promise<{ eth: Eip1193; me: Address }> {
  const eth = getEth();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask, Rabby or another wallet, then reload.");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const hexId = `0x${cfg.chainId.toString(16)}`;
  if (((await eth.request({ method: "eth_chainId" })) as string).toLowerCase() !== hexId) {
    try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] }); }
    catch {
      await eth.request({ method: "wallet_addEthereumChain", params: [{
        chainId: hexId, chainName: chainLabel(cfg.chainId), nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
        rpcUrls: [cfg.rpc], blockExplorerUrls: cfg.explorer ? [cfg.explorer] : undefined,
      }] });
    }
  }
  return { eth, me: accounts[0] as Address };
}

/** USDC balance read through the user's own wallet; undefined if it cannot be read. */
export async function usdcBalance(eth: Eip1193, token: string, me: Address): Promise<bigint | undefined> {
  try {
    const pc = createPublicClient({ transport: custom(eth) });
    return (await pc.readContract({
      address: token as Address, functionName: "balanceOf", args: [me],
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    })) as bigint;
  } catch { return undefined; }
}

/** The one signature: an EIP-3009 authorisation whose nonce binds this cart hash and this payee. */
export async function signPayment(eth: Eip1193, me: Address, cfg: ChainCfg, cartHash: string, payTo: string, amountUnits: bigint) {
  const nonce = keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }],
    ["GROWW.v1", BigInt(cfg.chainId), cfg.settler as Address, `0x${cartHash}` as Hex, payTo as Address],
  ));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
  const wc = createWalletClient({ account: me, transport: custom(eth) });
  const signature = await wc.signTypedData({
    account: me, domain: cfg.domain as never, types: RECEIVE_TYPES, primaryType: "ReceiveWithAuthorization",
    message: { from: me, to: cfg.settler as Address, value: amountUnits, validAfter: 0n, validBefore, nonce },
  });
  const p = parseSignature(signature);
  return { nonce, signature, authorization: { validAfter: "0", validBefore: validBefore.toString(), v: Number(p.v ?? BigInt(27 + (p.yParity ?? 0))), r: p.r, s: p.s } };
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const sortKeys = (v: unknown): unknown => (v === null || typeof v !== "object" ? v : Array.isArray(v) ? v.map(sortKeys)
  : Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])));
export const cartHashInBrowser = (contents: unknown) => sha256Hex(JSON.stringify(sortKeys(contents)));

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `request failed (${res.status})`);
  return json as T;
}
