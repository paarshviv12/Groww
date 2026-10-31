// Checks the agent wallet on HashKey Chain mainnet before you deploy. Reads ../.env.mainnet.
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, formatEther, formatUnits, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.mainnet", import.meta.url), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const rpc = process.env.HSK_MAINNET_RPC || "https://mainnet.hsk.xyz";
const USDCE = "0x054ed45810DbBAb8B27668922D110669c9D88D0a" as Address;
const chain = defineChain({ id: 177, name: "HSK Chain", nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pc = createPublicClient({ chain, transport: http(rpc) });
const me = privateKeyToAccount(env.AGENT_KEY as Hex).address;

const id = await pc.getChainId().catch((e) => { throw new Error(`Cannot reach ${rpc}: ${e.shortMessage ?? e.message}`); });
const hsk = await pc.getBalance({ address: me });
const usdc = (await pc.readContract({ address: USDCE, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [me] })) as bigint;
const code = await pc.getCode({ address: USDCE });

console.log(`chain id     ${id} ${id === 177 ? "(HSK Chain mainnet)" : "(WRONG NETWORK)"}`);
console.log(`agent wallet ${me}`);
console.log(`HSK          ${formatEther(hsk)} ${hsk >= 5n * 10n ** 16n ? "ok" : "need about 0.05 HSK"}`);
console.log(`USDC.e       ${formatUnits(usdc, 6)} ${usdc >= 1_000_000n ? "ok" : "need about 2 USDC.e"}`);
console.log(`USDC.e contract present: ${code && code !== "0x" ? "yes" : "NO"}`);
process.exit(id === 177 && hsk > 0n && usdc >= 1_000_000n ? 0 : 2);
