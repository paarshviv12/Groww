// Records a live run into public/runs/latest.json so the hosted page can replay it without spending funds.
// usage: BASE=http://localhost:3100 MODE=pay SERVICE=chain-pulse DEMO_KEY=... npx tsx scripts/record-run.mts
import { writeFileSync, mkdirSync } from "node:fs";
const base = process.env.BASE ?? "http://localhost:3100";
const mode = process.env.MODE ?? "pay";
const res = await fetch(`${base}/api/run`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(process.env.DEMO_KEY ? { "x-demo-key": process.env.DEMO_KEY } : {}) },
  body: JSON.stringify({ mode, serviceId: process.env.SERVICE ?? "chain-pulse", target: process.env.TARGET }),
});
if (!res.ok || !res.body) throw new Error(`run failed: ${res.status} ${await res.text()}`);
const text = await res.text();
let meta: unknown, events: unknown[] = [];
for (const line of text.split("\n").filter(Boolean)) {
  const m = JSON.parse(line);
  if (m.type === "done") { meta = m.summary?.meta; events = m.events; }
  if (m.type === "error") throw new Error(m.error);
}
if (!meta) throw new Error("run produced no summary");
mkdirSync("public/runs", { recursive: true });
const out = process.env.OUT ?? "public/runs/latest.json";
writeFileSync(out, JSON.stringify({ mode, recordedAt: new Date().toISOString(), meta, events }, null, 2));
console.log(`recorded ${events.length} events (${mode}) -> ${out}`);
