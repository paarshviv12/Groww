import { HttpMerchantClient } from "@/lib/agents/merchant";
import { payerConfigFromEnv, runPaymentFlow } from "@/lib/agents/payer";
import { runTamperDemo } from "@/lib/agents/attacks";
import { jsonSafe } from "@/lib/chain";
import { Tracer } from "@/lib/trace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Live runs spend real (tiny) funds, so a hosted deployment can require a demo key.
export async function POST(req: Request) {
  const need = process.env.DEMO_KEY;
  if (need && req.headers.get("x-demo-key") !== need) {
    return Response.json({ error: "Live runs on this deployment need the demo key. Replay a recorded run instead." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { mode?: "pay" | "tamper"; serviceId?: string; target?: string };
  // The demo merchant is this same server. On a host like Render the public URL is behind a proxy,
  // so call ourselves on the local port instead of whatever origin the request reports.
  const origin = process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : new URL(req.url).origin;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(jsonSafe(o)) + "\n"));
      try {
        const cfg = payerConfigFromEnv();
        const tracer = new Tracer((event) => send({ type: "event", event }));
        const merchant = new HttpMerchantClient(origin);
        const summary = body.mode === "tamper"
          ? await runTamperDemo(cfg, merchant, tracer)
          : await runPaymentFlow(cfg, merchant, { serviceId: body.serviceId ?? "wallet-snapshot", target: body.target }, tracer);
        send({ type: "done", summary, events: tracer.events });
      } catch (e) {
        const err = e as Error & { cause?: { code?: string; message?: string } };
        const why = err.cause?.code || err.cause?.message;
        send({ type: "error", error: why ? `${err.message} (${why})` : err.message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
