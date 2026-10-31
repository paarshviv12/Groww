import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { cartStatus, decodeCart, describeCart, issuerFromEnv } from "@/lib/v1";
export const dynamic = "force-dynamic";

/** Check a cart (object or pay-link token): is our signature on it, is it current, is it already paid? */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const iss = issuerFromEnv();
    const cart = typeof body.cart === "string" ? decodeCart(body.cart) : body.cart;
    const view = await describeCart(iss, cart);
    const status = view.valid ? await cartStatus(iss, `0x${view.cartHash}` as Hex) : { status: "unpaid" as const };
    return NextResponse.json({ ...view, ...status });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
