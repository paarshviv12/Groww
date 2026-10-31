import { NextResponse } from "next/server";
import type { Address } from "viem";
import { ADDR, clientIp, issuerFromEnv, paymentsTo, rateLimit } from "@/lib/v1";
export const dynamic = "force-dynamic";

/** Payments settled to an address, newest first, read from the contract's events. */
export async function GET(req: Request) {
  if (!rateLimit(`pay:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "too many requests, slow down" }, { status: 429 });
  const u = new URL(req.url);
  const payee = u.searchParams.get("payee") ?? "";
  if (!ADDR.test(payee)) return NextResponse.json({ error: "payee must be a 0x address" }, { status: 400 });
  try {
    const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 25) || 25, 1), 100);
    return NextResponse.json({ payee, payments: await paymentsTo(issuerFromEnv(), payee as Address, limit) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
