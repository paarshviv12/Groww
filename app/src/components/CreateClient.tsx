"use client";
import { useEffect, useRef, useState } from "react";
import { api, chainLabel, getEth, short, type ChainCfg } from "@/lib/wallet";
import { Pebble } from "@/components/Pebble";
import { CopyButton } from "@/components/CopyButton";

interface Created { id: string; payUrl: string; expiresAt: string }
interface Status { status: "settled" | "unpaid"; settlement?: { payer: string; amountUsd: string; txHash?: string; explorerUrl?: string } }
type Cfg = ChainCfg & { minCartUsd: string; maxCartUsd: string };

export function CreateClient() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [payTo, setPayTo] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [name, setName] = useState("");
  const [mins, setMins] = useState("120");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<Created | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api<Cfg>("/api/v1/config").then(setCfg).catch(() => {});
    try { const s = localStorage.getItem("groww.payTo"); if (s) setPayTo(s); } catch { /* optional */ }
  }, []);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  async function useWallet() {
    try {
      const eth = getEth(); if (!eth) throw new Error("No browser wallet found.");
      const a = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setPayTo(a[0]);
    } catch (e) { setErr((e as Error).message); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true); setMade(null); setSt(null);
    if (timer.current) window.clearInterval(timer.current);
    try {
      const r = await api<Created>("/api/v1/carts", { payTo: payTo.trim(), amountUsd: amount.trim(), description: desc.trim() || undefined, merchantName: name.trim() || undefined, expiresInMinutes: Number(mins) });
      setMade(r);
      try { localStorage.setItem("groww.payTo", payTo.trim()); } catch { /* optional */ }
      const check = async () => { try { setSt(await api<Status>(`/api/v1/carts/${r.id}`)); } catch { /* keep polling */ } };
      await check();
      timer.current = window.setInterval(check, 4000);
    } catch (e2) { setErr((e2 as Error).message); }
    setBusy(false);
  }

  const paid = st?.status === "settled";
  return (
    <main className="ap-main" id="main">
      <section className="ap-card">
        <div className="ap-pay-top">
          <div>
            <p className="ap-kicker">For merchants and agents</p>
            <h1 className="disp ap-h">Get paid in USDC. <span className="skew">Send a link.</span></h1>
            <p className="ap-lead">Fill in who gets paid and how much. You get a link anyone can pay with a wallet, and the page tells you the moment the chain settles it. No account needed.</p>
          </div>
          <Pebble state={paid ? "wink" : made ? "thinking" : "idle"} size={120} label="The GROWW pebble" />
        </div>

        <form className="ap-form" onSubmit={submit}>
          <label>Your wallet address (money goes here)
            <span className="ap-row">
              <input value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="0x…" required pattern="0x[a-fA-F0-9]{40}" spellCheck={false} autoComplete="off" />
              <button type="button" className="btn quiet" onClick={useWallet}>Use my wallet</button>
            </span>
          </label>
          <div className="ap-two">
            <label>Amount in USD
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.50" inputMode="decimal" required pattern="\d+(\.\d{1,6})?" />
              {cfg && <small>Between ${cfg.minCartUsd} and ${cfg.maxCartUsd}. Paid in USDC.</small>}
            </label>
            <label>Valid for
              <select value={mins} onChange={(e) => setMins(e.target.value)}>
                <option value="30">30 minutes</option><option value="120">2 hours</option><option value="1440">1 day</option><option value="10080">7 days</option>
              </select>
            </label>
          </div>
          <label>What is it for?
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Logo design, order #1042…" maxLength={120} />
          </label>
          <label>Your name or shop (shown to the payer)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio" maxLength={60} />
          </label>
          <button className="pill black" disabled={busy}>{busy ? "Creating…" : "Create pay link"}</button>
          {err && <p className="ap-note bad-note" role="alert">{err}</p>}
          {cfg && <p className="ap-small">Network: {chainLabel(cfg.chainId)}{cfg.chainId !== 177 ? ". This is a test network, no real money." : ""}</p>}
        </form>

        {made && (
          <div className="ap-result">
            <h2 className="disp">{paid ? "Paid." : "Your link is ready."}</h2>
            <div className="ap-linkbox">
              <input readOnly value={made.payUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Pay link" />
              <CopyButton text={made.payUrl} label="Copy link" />
              <a className="btn" href={made.payUrl} target="_blank" rel="noreferrer">Open</a>
            </div>
            <p className="ap-small">Valid until {new Date(made.expiresAt).toLocaleString()} · Cart {short(made.id, 8)}</p>
            <p className={`ap-status ${paid ? "paid" : ""}`} aria-live="polite">
              {paid
                ? <>Paid ${st?.settlement?.amountUsd} by {short(st?.settlement?.payer ?? "", 6)}. {st?.settlement?.explorerUrl && <a href={st.settlement.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}</>
                : "Waiting for payment. This page checks the chain every few seconds."}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
