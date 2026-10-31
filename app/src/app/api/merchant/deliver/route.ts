import { NextResponse } from "next/server";
import { merchantDeliver, merchantConfigFromEnv } from "@/lib/agents/merchant";
import { jsonSafe } from "@/lib/chain";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: Request) {
  try { return NextResponse.json(jsonSafe(await merchantDeliver(merchantConfigFromEnv(), await req.json()))); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
