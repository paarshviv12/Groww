import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { cartStatus, issuerFromEnv } from "@/lib/v1";
export const dynamic = "force-dynamic";

/** Is this cart paid? Answered from the settlement contract on chain. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hex = id.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return NextResponse.json({ error: "id must be the 64-character cart hash" }, { status: 400 });
  try { return NextResponse.json({ id: hex, ...(await cartStatus(issuerFromEnv(), `0x${hex}` as Hex)) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
