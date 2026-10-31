import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, parseAbi,
  type Address, type Chain, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BaseError, ContractFunctionRevertedError } from "viem";

export type NetworkName = "local" | "testnet" | "mainnet";

export interface NetConfig {
  name: NetworkName;
  chainId: number;
  rpc: string;
  explorer: string;
  usdc: Address;
  settler: Address;
  tokenDomain: { name: string; version: string };
  chain: Chain;
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const native = { name: "HSK", symbol: "HSK", decimals: 18 };

export function netConfig(name: NetworkName = (process.env.NETWORK as NetworkName) ?? "local"): NetConfig {
  const settler = (process.env.SETTLER_ADDRESS as Address | undefined) ?? ZERO;
  if (name === "mainnet") {
    const rpc = process.env.HSK_MAINNET_RPC || "https://mainnet.hsk.xyz";
    return {
      name, chainId: 177, rpc, explorer: "https://hsk.blockscout.com", settler,
      usdc: (process.env.USDC_ADDRESS as Address) ?? "0x054ed45810DbBAb8B27668922D110669c9D88D0a",
      tokenDomain: { name: "Bridged USDC", version: "2" },
      chain: defineChain({ id: 177, name: "HSK Chain", nativeCurrency: native, rpcUrls: { default: { http: [rpc] } } }),
    };
  }
  if (name === "testnet") {
    const rpc = process.env.HSK_TESTNET_RPC || "https://testnet.hsk.xyz";
    return {
      name, chainId: 133, rpc, explorer: "https://testnet-explorer.hskchain.net", settler,
      usdc: (process.env.USDC_ADDRESS as Address) ?? "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6",
      tokenDomain: { name: "USD Coin", version: "2" },
      chain: defineChain({ id: 133, name: "HSK Chain Testnet", nativeCurrency: native, rpcUrls: { default: { http: [rpc] } } }),
    };
  }
  const rpc = process.env.LOCAL_RPC || "http://127.0.0.1:8545";
  return {
    name: "local", chainId: 31337, rpc, explorer: "", settler,
    usdc: (process.env.USDC_ADDRESS as Address) ?? ZERO,
    tokenDomain: { name: "Bridged USDC", version: "2" },
    chain: defineChain({ id: 31337, name: "Local", nativeCurrency: native, rpcUrls: { default: { http: [rpc] } } }),
  };
}

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export const publicClientFor = (cfg: NetConfig): PublicClient =>
  createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) }) as PublicClient;

export const walletClientFor = (cfg: NetConfig, key: Hex) =>
  createWalletClient({ account: privateKeyToAccount(key), chain: cfg.chain, transport: http(cfg.rpc) });

export const explorerTx = (cfg: NetConfig, hash: string) => (cfg.explorer ? `${cfg.explorer}/tx/${hash}` : "");
export const explorerAddr = (cfg: NetConfig, a: string) => (cfg.explorer ? `${cfg.explorer}/address/${a}` : "");

/**
 * The EIP-3009 nonce the payer signs. Mirrors MandateSettler.authNonceFor:
 * keccak256(abi.encode("GROWW.v1", chainId, settler, cartHash, payee)).
 * Binding the cart hash + payee into the nonce is what makes one wallet signature authorise exactly one cart.
 */
export function authNonceOf(cfg: NetConfig, cartHash: Hex, payee: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }],
      ["GROWW.v1", BigInt(cfg.chainId), cfg.settler, cartHash, payee],
    ),
  );
}

export const receiveAuthTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Reads the token's real EIP-712 domain from the chain, falling back to the configured one. */
export async function tokenDomain(cfg: NetConfig, pc: PublicClient) {
  try {
    const [name, version] = await Promise.all([
      pc.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "name" }),
      pc.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "version" }),
    ]);
    return { name, version, chainId: cfg.chainId, verifyingContract: cfg.usdc };
  } catch {
    return { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.usdc };
  }
}

export const jsonSafe = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** A short, human-readable reason for a reverted call (custom error name, revert string, or a trimmed message). */
export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const hit = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (hit) {
      const d = hit.data;
      if (d?.errorName === "Error" && typeof d.args?.[0] === "string") return d.args[0];
      return d?.errorName ?? hit.reason ?? hit.shortMessage;
    }
    return e.shortMessage;
  }
  return (e as Error).message ?? "reverted";
}
