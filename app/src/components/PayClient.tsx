"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, cartHashInBrowser, chainLabel, connectWallet, short, signPayment, unitsOf, usdcBalance, type ChainCfg } from "@/lib/wallet";
import { Pebble, type PebbleState } from "@/components/Pebble";

interface Settlement { payer: string; payee: string; amountUsd: string; txHash?: string; block?: string; explorerUrl?: string; settledAt?: string }
interface View {
  cartHash: string; valid: boolean; error?: string; expired: boolean; expiresAt?: string; merchantName?: string; payTo?: string;
  amountUsd?: string; description?: string; chainId?: number; status: "settled" | "unpaid"; settlement?: Settlement;
}
type Cfg = ChainCfg & { name: string };
type Step = { text: string; state: "run" | "ok" | "fail" };

const decode = (t: string) => { try { return JSON.parse(atob(t.replace(/-/g, "+").replace(/_/g, "/"))) as { contents: unknown }; } catch { return null; } };

export function PayClient({ token }: { token: string }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [browserHash, setBrowserHash] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [me, setMe] = useState("");
  const poll = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const v = await api<View>("/api/v1/verify", { cart: token });
    setView(v);
    return v;
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const cart = decode(token);
        if (!cart) throw new Error("That pay link is damaged. Ask the merchant for a new one.");
        setBrowserHash(await cartHashInBrowser(cart.contents));
        const [c] = await Promise.all([api<Cfg>("/api/v1/config"), refresh()]);
        setCfg(c);
      } catch (e) { setLoadErr((e as Error).message); }
    })();
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [token, refresh]);

  const setStep = (text: string, state: Step["state"]) => setSteps((p) => {
    const i = p.findIndex((s) => s.text === text);
    if (i >= 0) { const n = [...p]; n[i] = { text, state }; return n; }
    return [...p, { text, state }];
  });

  async function pay() {
    if (!cfg || !view?.valid || !view.amountUsd || !view.payTo) return;
    setErr(""); setBusy(true); setSteps([]);
    try {
      setStep("Connecting your wallet", "run");
      const { eth, me: addr } = await connectWallet(cfg);
      setMe(addr); setStep("Connecting your wallet", "ok");

      const amount = unitsOf(view.amountUsd);
      setStep("Checking your balance", "run");
      const bal = await usdcBalance(eth, cfg.token, addr);
      if (bal !== undefined && bal < amount) throw new Error(`Your wallet holds $${(Number(bal) / 1e6).toFixed(2)} USDC, but this costs $${view.amountUsd}.`);
      setStep("Checking your balance", "ok");

      setStep("Waiting for your signature", "run");
      const { authorization } = await signPayment(eth, addr, cfg, view.cartHash, view.payTo, amount);
      setStep("Waiting for your signature", "ok");

      setStep("Settling on the chain", "run");
      await api(`/api/v1/carts/${view.cartHash}/settle`, { cart: token, payer: addr, authorization });
      setStep("Settling on the chain", "ok");

      setStep("Reading the receipt from the contract", "run");
      const v = await refresh();
      if (v.status !== "settled") throw new Error("The payment was sent but the contract shows no receipt yet. Refresh in a moment.");
      setStep("Reading the receipt from the contract", "ok");
    } catch (e) {
      const m = e as { code?: number; message?: string };
      setSteps((p) => p.map((s) => (s.state === "run" ? { ...s, state: "fail" } : s)));
      setErr(m.code === 4001 ? "You declined in your wallet. Nothing was signed and no funds moved." : m.message ?? "Something went wrong.");
    }
    setBusy(false);
  }

  const paid = view?.status === "settled";
  const pebble: PebbleState = paid ? "wink" : busy ? "orbit" : err ? "alert" : "idle";
  const bad = loadErr || (view && !view.valid);
  const match = Boolean(browserHash && view && browserHash === view.cartHash);
  const wrongNet = cfg && view?.chainId && view.chainId !== cfg.chainId;

  return (
    <main className="ap-main" id="main">
      <section className="ap-card ap-pay">
        <div className="ap-pay-top">
          <div>
            <p className="ap-kicker">{view?.merchantName ? `Pay ${view.merchantName}` : "Pay"}</p>
            {bad ? <h1 className="disp ap-h">This link can’t be paid.</h1>
              : <h1 className="disp ap-h">{view?.description || "Payment"}</h1>}
            {bad && <p className="ap-note bad-note">{loadErr || view?.error}</p>}
          </div>
          <Pebble state={pebble} size={120} label="The GROWW pebble reacts to your payment" />
        </div>

        {view?.valid && (
          <>
            <div className="ap-amount-row">
              <div className="ap-amt">${view.amountUsd}<small>USDC</small></div>
              <span className={`ap-pill ${paid ? "paid" : view.expired ? "exp" : "unpaid"}`}>{paid ? "Paid" : view.expired ? "Expired" : "Waiting for payment"}</span>
            </div>

            <dl className="ap-facts">
              <div><dt>Pays to</dt><dd title={view.payTo}>{short(view.payTo ?? "", 8)}</dd></div>
              <div><dt>Network</dt><dd>{cfg ? chainLabel(cfg.chainId) : "…"}</dd></div>
              <div><dt>Cart fingerprint</dt><dd title={view.cartHash}>{short(view.cartHash, 10)}</dd></div>
              <div><dt>Valid until</dt><dd>{view.expiresAt ? new Date(view.expiresAt).toLocaleString() : ""}</dd></div>
            </dl>

            <ul className="ap-checks" aria-label="Checks">
              <li className={view.valid ? "ok" : "no"}>The merchant’s signature on this cart is valid.</li>
              <li className={match ? "ok" : "no"}>Your browser recomputed the cart fingerprint itself and it {match ? "matches" : "does NOT match"}.</li>
              <li className="ok">Your wallet signs once. The cart fingerprint and the payee are inside what you sign, so the contract refuses anything else.</li>
              <li className="ok">You pay no gas. The payment is relayed for you.</li>
            </ul>

            {wrongNet && <p className="ap-note bad-note">This cart is for another network than this server uses.</p>}

            {!paid && !view.expired && (
              <button className="pill black ap-go" onClick={pay} disabled={busy || !cfg || Boolean(wrongNet) || !match}>
                {busy ? "Working…" : `Pay $${view.amountUsd} with my wallet`}
              </button>
            )}
            {me && <p className="ap-small">Paying as {short(me, 8)}</p>}

            {steps.length > 0 && (
              <ol className="ap-steps" aria-live="polite">
                {steps.map((s) => <li key={s.text} className={s.state}><span>{s.state === "ok" ? "✓" : s.state === "fail" ? "✕" : "…"}</span>{s.text}</li>)}
              </ol>
            )}
            {err && <p className="ap-note bad-note" role="alert">{err}</p>}

            {paid && view.settlement && (
              <div className="ap-receipt">
                <h2 className="disp">Paid. Read from the chain.</h2>
                <dl className="ap-facts">
                  <div><dt>From</dt><dd title={view.settlement.payer}>{short(view.settlement.payer, 8)}</dd></div>
                  <div><dt>To</dt><dd title={view.settlement.payee}>{short(view.settlement.payee, 8)}</dd></div>
                  <div><dt>Amount</dt><dd>${view.settlement.amountUsd} USDC</dd></div>
                  <div><dt>When</dt><dd>{view.settlement.settledAt ? new Date(view.settlement.settledAt).toLocaleString() : ""}</dd></div>
                  {view.settlement.block && <div><dt>Block</dt><dd>{view.settlement.block}</dd></div>}
                  {view.settlement.txHash && <div><dt>Transaction</dt><dd>{view.settlement.explorerUrl ? <a href={view.settlement.explorerUrl} target="_blank" rel="noreferrer">{short(view.settlement.txHash, 8)}</a> : short(view.settlement.txHash, 8)}</dd></div>}
                </dl>
              </div>
            )}
          </>
        )}
        {!view && !loadErr && <p className="ap-note">Checking this cart…</p>}
      </section>
    </main>
  );
}
