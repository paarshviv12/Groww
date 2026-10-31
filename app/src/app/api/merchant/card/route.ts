import { NextResponse } from "next/server";
import { merchantCard, merchantConfigFromEnv } from "@/lib/agents/merchant";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(merchantCard(merchantConfigFromEnv())); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
