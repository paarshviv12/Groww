import { netConfig, publicClientFor, tokenDomain } from "@/lib/chain";
import { issuerFromEnv, publicOrigin } from "@/lib/v1";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const n = netConfig();
  const domain = await tokenDomain(n, publicClientFor(n)).catch(() => ({ ...n.tokenDomain, chainId: n.chainId, verifyingContract: n.usdc }));
  let limits = { minCartUsd: "0.01", maxCartUsd: "1000" };
  try { const i = issuerFromEnv(); limits = { minCartUsd: i.minCartUsd, maxCartUsd: i.maxCartUsd }; } catch { /* config shown even if relayer is missing */ }
  return Response.json({
    name: "GROWW", version: "v1", api: `${publicOrigin(req)}/api/v1`,
    network: n.name, chainId: n.chainId, settler: n.settler, token: n.usdc, rpc: n.rpc, explorer: n.explorer, domain, ...limits,
  });
}
