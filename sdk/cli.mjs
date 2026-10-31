#!/usr/bin/env node
import { Groww } from "./index.mjs";

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {}; const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true"; flags[k] = v; }
  else rest.push(argv[i]);
}
const api = flags.api ?? process.env.GROWW_API;
const out = (o) => console.log(JSON.stringify(o, null, 2));

const help = `groww: pay and create carts on HashKey Chain

  groww cart   --to 0xPAYEE --amount 1.50 [--desc "Report"] [--name "My Shop"] [--minutes 120]
  groww pay    <pay-link|token> [--max 5] [--allow 0xPAYEE] [--dry-run]       (key: $GROWW_KEY)
  groww status <cart-id>
  groww incoming --to 0xPAYEE

  --api URL   GROWW server (or set GROWW_API)`;

try {
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(help); process.exit(0); }
  if (!api) throw new Error("set --api or GROWW_API to the GROWW server URL");
  const g = new Groww({ api });
  if (cmd === "cart") {
    if (!flags.to || !flags.amount) throw new Error("cart needs --to and --amount");
    const r = await g.createCart({ payTo: flags.to, amountUsd: flags.amount, description: flags.desc, merchantName: flags.name, expiresInMinutes: flags.minutes ? Number(flags.minutes) : undefined });
    out({ id: r.id, payUrl: r.payUrl, expiresAt: r.expiresAt });
  } else if (cmd === "pay") {
    if (!rest[0]) throw new Error("pay needs a pay link");
    const key = process.env.GROWW_KEY;
    if (!key) throw new Error("set GROWW_KEY to the paying wallet's private key (it never leaves this machine)");
    out(await g.pay(rest[0], { privateKey: key, maxUsd: flags.max ?? "1", allowPayTo: flags.allow ? [flags.allow] : undefined, dryRun: flags["dry-run"] === "true" }));
  } else if (cmd === "status") {
    if (!rest[0]) throw new Error("status needs a cart id");
    out(await g.status(rest[0]));
  } else if (cmd === "incoming") {
    if (!flags.to) throw new Error("incoming needs --to");
    out(await g.payments(flags.to));
  } else { console.log(help); process.exit(1); }
} catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
