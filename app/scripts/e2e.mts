// End-to-end run of both agents. Reads deployment info from ../chain/deployments/<network>.json
import fs from "node:fs";
import { InProcessMerchantClient, merchantConfigFromEnv } from "../src/lib/agents/merchant";
import { payerConfigFromEnv, runPaymentFlow } from "../src/lib/agents/payer";
import { Tracer } from "../src/lib/trace";

const dep = process.env.DEPLOYMENT ?? "../../chain/deployments/localhost.json";
const d = JSON.parse(fs.readFileSync(new URL(dep, import.meta.url), "utf8"));
process.env.SETTLER_ADDRESS ??= d.settler;
if (d.usdc) process.env.USDC_ADDRESS ??= d.usdc;

const tracer = new Tracer((e) => {
  const icon = e.status === "ok" ? "✔" : e.status === "fail" ? "✘" : "•";
  console.log(`${icon} [${e.actor}] ${e.title}${e.hspState ? `  (${e.hspState})` : ""}`);
  if (e.detail) console.log(`    ${e.detail}`);
});

const target = process.env.TARGET ?? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const merchant = new InProcessMerchantClient(merchantConfigFromEnv());
const res = await runPaymentFlow(payerConfigFromEnv(), merchant, { serviceId: "wallet-snapshot", target }, tracer);
console.log("\nRESULT:", JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
process.exit(res.ok ? 0 : 1);
