import { NextResponse } from "next/server";
import { clientIp, createCart, encodeCart, issuerFromEnv, publicOrigin, rateLimit } from "@/lib/v1";
import { cartHashOf } from "@/lib/hsp/canonical";
export const dynamic = "force-dynamic";

/** Create a signed cart. No account or key is needed: a cart only ever pays the address it names. */
export async function POST(req: Request) {
  if (!rateLimit(`cart:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "too many requests, slow down" }, { status: 429 });
  try {
    const body = await req.json();
    const cart = await createCart(issuerFromEnv(), body);
    const id = cartHashOf(cart.contents);
    const origin = publicOrigin(req);
    return NextResponse.json({
      id, cart, payUrl: `${origin}/pay/${encodeCart(cart)}`, statusUrl: `${origin}/api/v1/carts/${id}`, expiresAt: cart.contents.cart_expiry,
    }, { status: 201 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
