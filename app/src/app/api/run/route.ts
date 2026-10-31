import { InProcessMerchantClient, merchantConfigFromEnv } from "@/lib/agents/merchant";
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
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(jsonSafe(o)) + "\n"));
      try {
        const cfg = payerConfigFromEnv();
        const tracer = new Tracer((event) => send({ type: "event", event }));
        // The demo merchant lives in this same server, so call it directly (no network hop).
        const merchant = new InProcessMerchantClient(merchantConfigFromEnv());
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
