import { NextResponse } from "next/server";
import { cartHashOf } from "@/lib/hsp/canonical";
import { clientIp, decodeCart, issuerFromEnv, rateLimit, settleCart } from "@/lib/v1";
import { jsonSafe } from "@/lib/chain";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Relay a payer's signed Payment Mandate. The payer pays no gas; the chain checks the signature, cart, amount and payee. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`settle:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: "too many requests, slow down" }, { status: 429 });
  try {
    const { id } = await params;
    const body = await req.json();
    const cart = typeof body.cart === "string" ? decodeCart(body.cart) : body.cart;
    if (cartHashOf(cart.contents) !== id.replace(/^0x/, "").toLowerCase()) throw new Error("cart does not match the id in the URL");
    return NextResponse.json(jsonSafe(await settleCart(issuerFromEnv(), { cart, payer: body.payer, authorization: body.authorization })));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
