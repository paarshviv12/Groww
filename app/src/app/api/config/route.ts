import { netConfig, publicClientFor, tokenDomain } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET() {
  const n = netConfig();
  // The wallet needs the token's real EIP-712 domain to build the signature request.
  const domain = await tokenDomain(n, publicClientFor(n)).catch(() => ({ ...n.tokenDomain, chainId: n.chainId, verifyingContract: n.usdc }));
  return Response.json({
    network: n.name, chainId: n.chainId, settler: n.settler, rpc: n.rpc, token: n.usdc, explorer: n.explorer, domain,
    liveNeedsKey: Boolean(process.env.DEMO_KEY),
  });
}
