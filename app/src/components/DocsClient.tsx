"use client";
import { useEffect, useState } from "react";
import { api, chainLabel, type ChainCfg } from "@/lib/wallet";
import { CopyButton } from "@/components/CopyButton";

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="ap-code">
      <div className="ap-code-bar"><span>{label}</span><CopyButton text={children} /></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

export function DocsClient() {
  const [cfg, setCfg] = useState<(ChainCfg & { api: string }) | null>(null);
  useEffect(() => { api<ChainCfg & { api: string }>("/api/v1/config").then(setCfg).catch(() => {}); }, []);
  const base = cfg?.api?.replace(/\/api\/v1$/, "") ?? "https://YOUR-GROWW-URL";

  return (
    <main className="ap-main" id="main">
      <section className="ap-card ap-docs">
        <p className="ap-kicker">Docs</p>
        <h1 className="disp ap-h">Accept payments from people <span className="skew">and AI agents.</span></h1>
        <p className="ap-lead">GROWW turns an order into a signed cart, lets a wallet or an agent pay it with one signature, and settles it through one contract on HashKey Chain. Whether it is paid is always read from the chain.</p>

        {cfg && (
          <dl className="ap-facts">
            <div><dt>Network</dt><dd>{chainLabel(cfg.chainId)}</dd></div>
            <div><dt>Settlement contract</dt><dd title={cfg.settler}>{cfg.settler}</dd></div>
            <div><dt>Token</dt><dd title={cfg.token}>USDC · {cfg.token}</dd></div>
            <div><dt>API</dt><dd>{base}/api/v1</dd></div>
          </dl>
        )}

        <h2 className="disp">1. Create a cart</h2>
        <p>Say who gets paid and how much. You get a pay link and a cart id. No key and no account.</p>
        <Code label="curl">{`curl -X POST ${base}/api/v1/carts \\
  -H 'content-type: application/json' \\
  -d '{"payTo":"0xYOUR_WALLET","amountUsd":"1.50","description":"Logo design","merchantName":"Acme Studio"}'`}</Code>
        <p>The answer has <code>id</code> (the cart fingerprint), <code>payUrl</code> and <code>expiresAt</code>. Send <code>payUrl</code> to your customer.</p>

        <h2 className="disp">2. Get paid</h2>
        <p><strong>A person</strong> opens the pay link, connects a wallet and signs once. <strong>An AI agent</strong> pays from code:</p>
        <Code label="node">{`import { Groww } from "groww-sdk";

const groww = new Groww({ api: "${base}" });
const receipt = await groww.pay(payUrl, {
  privateKey: process.env.GROWW_KEY,   // stays on your machine
  maxUsd: "5",                         // the agent refuses anything above this
  allowPayTo: ["0xYOUR_WALLET"],       // optional: only pay these addresses
});
console.log(receipt.txHash);`}</Code>
        <p>Or from the terminal:</p>
        <Code label="terminal">{`export GROWW_API=${base}
export GROWW_KEY=0x...            # paying wallet's private key
npx groww pay "<payUrl>" --max 5`}</Code>

        <h2 className="disp">3. Know it is paid</h2>
        <Code label="curl">{`curl ${base}/api/v1/carts/<id>
# {"status":"settled","settlement":{"payer":"0x…","amountUsd":"1.50","txHash":"0x…"}}

curl "${base}/api/v1/payments?payee=0xYOUR_WALLET"   # everything paid to you`}</Code>
        <p>Both answers come from the settlement contract’s receipts and events. They are not stored by us, so nobody can fake them.</p>

        <h2 className="disp">What one signature covers</h2>
        <p>The payer’s wallet signs an EIP-3009 authorisation whose nonce is <code>keccak256(“GROWW.v1”, chainId, contract, cartHash, payee)</code>, and whose value is the amount. So the signature only works for that cart, to that payee, for that amount. A relayer who changes any of them makes the contract refuse it. Each cart can settle once, so a replay fails. The payer pays no gas.</p>

        <h2 className="disp">API</h2>
        <div className="ap-tablewrap">
          <table className="ap-table">
            <thead><tr><th>Call</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td><code>POST /api/v1/carts</code></td><td>Create a signed cart. Body: <code>payTo</code>, <code>amountUsd</code> (or <code>items</code>), <code>description</code>, <code>merchantName</code>, <code>expiresInMinutes</code>.</td></tr>
              <tr><td><code>GET /api/v1/carts/:id</code></td><td>Paid or unpaid, with the receipt read from the contract.</td></tr>
              <tr><td><code>POST /api/v1/verify</code></td><td>Check a cart or pay link: signature, expiry, paid state.</td></tr>
              <tr><td><code>POST /api/v1/carts/:id/settle</code></td><td>Relay a payer’s signed mandate. The chain dry-runs it first.</td></tr>
              <tr><td><code>GET /api/v1/payments?payee=0x…</code></td><td>Payments settled to an address, newest first.</td></tr>
              <tr><td><code>GET /api/v1/config</code></td><td>Network, contract, token and limits.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="ap-small">Carts follow the HashKey Settlement Protocol Cart Mandate format. The HSP gateway rail needs merchant credentials issued by HashKey, so it is not connected here. Settlement goes straight through our contract.</p>
      </section>
    </main>
  );
}
