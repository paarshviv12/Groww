"use client";
import { useCallback, useEffect, useState } from "react";
import { api, getEth, short, type ChainCfg } from "@/lib/wallet";

interface P { cartHash: string; payer: string; amountUsd: string; txHash?: string; explorerUrl?: string; settledAt?: string; block?: string }
const sum = (ps: P[]) => { let u = 0n; for (const p of ps) { const [d, f = ""] = p.amountUsd.split("."); u += BigInt(d) * 1_000_000n + BigInt((f + "000000").slice(0, 6)); } return `${u / 1_000_000n}.${(u % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0")}`; };

export function DashboardClient() {
  const [addr, setAddr] = useState("");
  const [rows, setRows] = useState<P[] | null>(null);
  const [cfg, setCfg] = useState<ChainCfg | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (a: string) => {
    setErr(""); setBusy(true);
    try { setRows((await api<{ payments: P[] }>(`/api/v1/payments?payee=${a}&limit=50`)).payments); try { localStorage.setItem("groww.payTo", a); } catch { /* optional */ } }
    catch (e) { setErr((e as Error).message); setRows(null); }
    setBusy(false);
  }, []);

  useEffect(() => {
    api<ChainCfg>("/api/v1/config").then(setCfg).catch(() => {});
    try { const s = localStorage.getItem("groww.payTo"); if (s && /^0x[a-fA-F0-9]{40}$/.test(s)) { setAddr(s); load(s); } } catch { /* optional */ }
  }, [load]);

  useEffect(() => {
    if (!rows || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return;
    const t = window.setInterval(() => load(addr), 10000);
    return () => window.clearInterval(t);
  }, [rows, addr, load]);

  async function useWallet() {
    try {
      const eth = getEth(); if (!eth) throw new Error("No browser wallet found.");
      const a = ((await eth.request({ method: "eth_requestAccounts" })) as string[])[0];
      setAddr(a); load(a);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <main className="ap-main" id="main">
      <section className="ap-card">
        <p className="ap-kicker">For merchants</p>
        <h1 className="disp ap-h">Money in. <span className="skew">Straight from the chain.</span></h1>
        <p className="ap-lead">Enter the wallet you get paid at. This list is read from the settlement contract’s events, not from our database, so it is the same list anyone can check on the explorer.</p>
        <form className="ap-form" onSubmit={(e) => { e.preventDefault(); load(addr.trim()); }}>
          <label>Your wallet address
            <span className="ap-row">
              <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" pattern="0x[a-fA-F0-9]{40}" required spellCheck={false} autoComplete="off" />
              <button type="button" className="btn quiet" onClick={useWallet}>Use my wallet</button>
            </span>
          </label>
          <button className="pill black" disabled={busy}>{busy ? "Reading the chain…" : "Show payments"}</button>
          {err && <p className="ap-note bad-note" role="alert">{err}</p>}
        </form>

        {rows && (
          <div className="ap-result">
            <h2 className="disp">{rows.length ? `$${sum(rows)} received` : "No payments yet"}</h2>
            {rows.length === 0 && <p className="ap-lead">Create a pay link and share it. Payments show up here a few seconds after the chain settles them.</p>}
            {rows.length > 0 && (
              <div className="ap-tablewrap">
                <table className="ap-table">
                  <thead><tr><th>When</th><th>From</th><th>Amount</th><th>Cart</th><th>Transaction</th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.cartHash}>
                        <td>{p.settledAt ? new Date(p.settledAt).toLocaleString() : `block ${p.block}`}</td>
                        <td title={p.payer}>{short(p.payer, 6)}</td>
                        <td><strong>${p.amountUsd}</strong></td>
                        <td title={p.cartHash}>{short(p.cartHash, 6)}</td>
                        <td>{p.explorerUrl ? <a href={p.explorerUrl} target="_blank" rel="noreferrer">{short(p.txHash ?? "", 6)}</a> : short(p.txHash ?? "", 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cfg && <p className="ap-small">Settlement contract {short(cfg.settler, 8)}{cfg.explorer ? <> · <a href={`${cfg.explorer}/address/${cfg.settler}`} target="_blank" rel="noreferrer">view on explorer</a></> : ""}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
