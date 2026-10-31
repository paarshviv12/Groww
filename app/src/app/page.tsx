"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeAbiParameters, http, keccak256, parseSignature, type Address, type Hex } from "viem";
import { settlerAbi } from "@/lib/generated/settler";
import type { TraceEvent } from "@/lib/trace";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Cheque as ChequeArt, Coin, GCoin, Lock, Logo, Pen, Stamp } from "@/components/art";
import { Pebble, type PebbleState } from "@/components/Pebble";
import { Letters } from "@/components/Letters";

// ---------- types ----------
interface Config { network: string; chainId: number; settler: string; rpc: string; token: string; explorer: string; liveNeedsKey: boolean; domain: { name: string; version: string; chainId: number; verifyingContract: Address } }
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global { interface Window { ethereum?: Eip1193 } }
interface Meta { network: string; chainId: number; settler: string; token: string; explorer: string; payer: string; payTo?: string }
interface Recorded { meta: Meta; events: TraceEvent[]; mode?: string; recordedAt?: string }
type Phase = "idle" | "running" | "done";
type Cart = {
  id: string; cart_expiry: string; merchant_name: string;
  payment_request: { details: { total: { amount?: unknown; value?: string; currency: string }; display_items?: { label: string }[] }; method_data: { data: { pay_to: string } }[] };
};

const SERVICES = [
  { id: "wallet-snapshot", title: "Wallet snapshot", price: "$0.02", note: "Balances and activity of any address" },
  { id: "chain-pulse", title: "Chain pulse", price: "$0.01", note: "Latest block, time and gas price" },
];
const ACTOR: Record<string, string> = { payer: "Payer agent", merchant: "Merchant agent", chain: "HSK Chain", policy: "Policy", gateway: "HSP gateway" };
const MARK: Record<string, string> = { ok: "✓", fail: "✕", warn: "!", info: "·" };

// ---------- helpers ----------
const short = (a: string, n = 6) => (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a);
const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${words(n % 100).toLowerCase()}` : ""}`;
  return `${words(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${words(n % 1000).toLowerCase()}` : ""}`;
}
function amountWords(v: string): string {
  const [d, c = ""] = v.split(".");
  return `${words(parseInt(d || "0", 10))} and ${(c + "00").slice(0, 2)}/100 dollars`;
}
const sortKeys = (v: unknown): unknown =>
  v === null || typeof v !== "object" ? v
    : Array.isArray(v) ? v.map(sortKeys)
    : Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A handwriting-like stroke derived from the signature bytes, so every signature looks different. */
function signaturePaths(sig: string, W = 330, H = 96): [string, string] {
  const hex = sig.replace(/^0x/, "");
  const byte = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2) || "80", 16);
  const n = 18;
  const pts: [number, number][] = Array.from({ length: n }, (_, i) => [
    10 + (i * (W - 40)) / (n - 1) + ((byte(i + 20) - 128) / 128) * 5,
    H * 0.46 + ((byte(i) - 128) / 128) * H * 0.4,
  ]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const y = H * 0.86;
  const flourish = `M${(W * 0.12).toFixed(1)} ${y.toFixed(1)} C${(W * 0.35).toFixed(1)} ${(y - 6 - (byte(40) % 12)).toFixed(1)} ${(W * 0.6).toFixed(1)} ${(y + 4 + (byte(41) % 8)).toFixed(1)} ${(W * 0.88).toFixed(1)} ${(y - 8).toFixed(1)}`;
  return [d, flourish];
}

function Guilloche() {
  const paths = useMemo(() => {
    const out: string[] = [];
    for (let k = 0; k < 7; k++) {
      const amp = 16 + k * 3, freq = 0.02 + k * 0.004, ph = k * 0.9, base = 40 + k * 4;
      let d = "";
      for (let x = 0; x <= 1000; x += 8) d += `${x ? "L" : "M"}${x} ${(base + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 2.3) * 5).toFixed(1)} `;
      out.push(d);
    }
    return out;
  }, []);
  return (
    <svg className="guil" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--guilloche)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
      {paths.map((d, i) => <path key={`b${i}`} d={d} transform="translate(0 250)" fill="none" stroke="var(--guilloche)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

// ---------- the cheque ----------
function Cheque({ events, mode }: { events: TraceEvent[]; mode: "pay" | "tamper" }) {
  const cartEv = events.find((e) => e.hspState === "payment-required");
  const signedEv = events.find((e) => e.hspState === "payment-submitted");
  const settledEv = events.find((e) => e.hspState === "payment-included" && e.status === "ok");
  const voided = mode === "tamper" && events.some((e) => e.title.startsWith("Every tampered mandate"));
  const cart = cartEv?.data?.cart as Cart | undefined;
  const total = cart?.payment_request.details.total as { amount?: { value: string }; value?: string } | undefined;
  const amount = (total?.amount as { value: string } | undefined)?.value ?? total?.value ?? "";
  const payee = (cartEv?.data?.pay_to as string | undefined) ?? "";
  const hash = (cartEv?.data?.cart_hash as string | undefined) ?? "";
  const signature = signedEv?.data?.signature as string | undefined;
  const nonce = signedEv?.data?.nonce as string | undefined;
  const signer = signedEv?.data?.signer as string | undefined;
  const memo = cart?.payment_request.details.display_items?.[0]?.label ?? "";
  const [stroke, flourish] = useMemo(() => (signature ? signaturePaths(signature) : ["", ""]), [signature]);
  const expires = cart ? new Date(cart.cart_expiry).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <section className="cheque" aria-label="The payment mandate, drawn as a cheque">
      <Guilloche />
      {cartEv && <div className="stamp issued" key="i">ISSUED<small>by the merchant agent</small></div>}
      {settledEv && !voided && <div className="stamp settled" key="s">SETTLED<small>block {String(settledEv.data?.block ?? "")}</small></div>}
      {voided && <div className="stamp void" key="v">VOID<small>tampered copies refused</small></div>}

      <div className="ch-top">
        <div className="ch-from">
          <b>{signer ? "Payer agent" : "Payer agent"}</b>
          {signer ? short(signer, 8) : "Waiting for the first quote"}
        </div>
        <div className="ch-no">{cart ? <>No. {cart.id}</> : "No. -"}<br />{cart ? expires && <>valid until {expires}</> : null}</div>
      </div>

      <div className="ch-row">
        <div>
          <p className="ch-label">Pay to the order of</p>
          <div className={`ch-fill ${payee ? "" : "blank"}`}>{payee || "recipient address"}</div>
        </div>
        <div className="ch-amt" aria-label="Amount">{amount ? `$${amount}` : "$ 0.00"}</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <p className="ch-label">Amount in words (USDC)</p>
        <div className={`ch-fill ${amount ? "" : "blank"}`}>{amount ? amountWords(amount) : " "}</div>
      </div>

      <div className="ch-bottom">
        <div>
          <p className="ch-label">Memo</p>
          <div className={`ch-fill ${memo ? "" : "blank"}`}>{memo || "what is being bought"}</div>
        </div>
        <div className="sig">
          {signature ? (
            <svg viewBox="0 0 330 96" key={signature} role="img" aria-label="Signature drawn from the wallet signature bytes">
              <path className="draw" d={stroke} pathLength={1} />
              <path className="draw two" d={flourish} pathLength={1} />
            </svg>
          ) : <svg viewBox="0 0 330 96" aria-hidden="true" />}
          <div className="sig-line">{signature ? "Signed by the payer's wallet (EIP-712)" : "Signature of the payer agent"}</div>
        </div>
      </div>

      <div className="micr" aria-label="Cart fingerprint and signed nonce">
        <span className="k">cart</span> :{hash ? hash : "0".repeat(16) + "…"}: <br />
        <span className="k">signed nonce</span> |{nonce ? nonce.slice(2) : "0".repeat(16) + "…"}|
      </div>
    </section>
  );
}

// ---------- the tape ----------
function Tape({ events, phase, endRef, pebble }: { events: TraceEvent[]; phase: Phase; endRef: React.RefObject<HTMLLIElement | null>; pebble: PebbleState }) {
  return (
    <div className="tape-wrap">
      <div className="tape-shell">
        <ol className="tape" aria-live="polite">
          <li className="tape-head" style={{ listStyle: "none" }}>
            <div>
              <h2>{phase === "running" && <span className="live-dot" aria-hidden="true" />}Receipt tape</h2>
              <p className="sub">Every step, in order, as it happens.</p>
            </div>
            <Pebble state={pebble} size={92} label="The GROW pebble reacts to the run" />
          </li>
          {events.length === 0 && <li className="tape-empty">Nothing yet. Run the agents or replay a recorded run.</li>}
          {events.map((e) => (
            <li key={e.id} className={`ev ${e.status}`}>
              <div className="ev-head">
                <span className="mk" aria-label={e.status}>{MARK[e.status]}</span>
                <span className="ev-title">{e.title}</span>
              </div>
              <div className="ev-meta">
                {ACTOR[e.actor] ?? e.actor} · +{(e.t / 1000).toFixed(2)}s
                {e.hspState && <span className="state" title="HSP payment state">{e.hspState}</span>}
              </div>
              {e.detail && <p className="ev-detail">{e.detail}</p>}
              {e.links && (
                <div className="ev-links">
                  {e.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer">{l.label}</a>)}
                </div>
              )}
              {e.data && (
                <details>
                  <summary>Raw data</summary>
                  <pre>{JSON.stringify(e.data, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
          <li ref={endRef} style={{ listStyle: "none", height: 1 }} />
        </ol>
      </div>
    </div>
  );
}

// ---------- check it yourself ----------
function Verify({ events, meta, config }: { events: TraceEvent[]; meta: Meta; config: Config | null }) {
  const cartEv = events.find((e) => e.hspState === "payment-required");
  const signedEv = events.find((e) => e.hspState === "payment-submitted");
  const settled = events.find((e) => e.hspState === "payment-included" && e.status === "ok");
  const [hashCheck, setHashCheck] = useState<{ mine: string; theirs: string } | null>(null);
  const [nonceCheck, setNonceCheck] = useState<{ mine: string; theirs: string } | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const cart = cartEv?.data?.cart;
      const theirs = cartEv?.data?.cart_hash as string | undefined;
      if (!cart || !theirs) return;
      const mine = await sha256Hex(JSON.stringify(sortKeys(cart)));
      if (live) setHashCheck({ mine, theirs });
      const payTo = cartEv?.data?.pay_to as Address | undefined;
      const sNonce = signedEv?.data?.nonce as string | undefined;
      if (sNonce && payTo) {
        const n = keccak256(encodeAbiParameters(
          [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }],
          ["GROWW.v1", BigInt(meta.chainId), meta.settler as Address, `0x${mine}` as Hex, payTo],
        ));
        if (live) setNonceCheck({ mine: n, theirs: sNonce });
      }
    })();
    return () => { live = false; };
  }, [cartEv, signedEv, meta]);

  const readChain = useCallback(async () => {
    if (!config || config.chainId !== meta.chainId) { setChain({ ok: false, text: "This page is connected to a different network than the run. Use the explorer link in the tape." }); return; }
    setBusy(true);
    try {
      const pc = createPublicClient({ transport: window.ethereum ? custom(window.ethereum) : http(config.rpc) });
      const hash = cartEv?.data?.cart_hash as string;
      const r = (await pc.readContract({ address: meta.settler as Address, abi: settlerAbi, functionName: "receipts", args: [`0x${hash}` as Hex] })) as readonly [Address, Address, Address, bigint, bigint, Hex];
      const same = r[1].toLowerCase() === String(cartEv?.data?.pay_to).toLowerCase() && r[0].toLowerCase() === String(signedEv?.data?.signer).toLowerCase();
      setChain(r[4] === 0n
        ? { ok: false, text: "The contract has no receipt for this cart." }
        : { ok: same, text: `${short(r[0])} paid ${short(r[1])} ${Number(r[3]) / 1e6} USDC. Settled at ${new Date(Number(r[4]) * 1000).toLocaleString()}.` });
    } catch (e) {
      setChain({ ok: false, text: `Could not read the chain from the browser (${(e as Error).message.slice(0, 80)}). Open the transaction in the explorer instead.` });
    } finally { setBusy(false); }
  }, [config, meta, cartEv, signedEv]);

  if (!cartEv) return null;
  const row = (ok: boolean | null, title: string, body: string, extra?: React.ReactNode) => (
    <div className={`vrow ${ok === null ? "" : ok ? "ok" : "fail"}`}>
      <span className="mk" aria-hidden="true">{ok === null ? "·" : ok ? "✓" : "✕"}</span>
      <div><h3>{title}</h3><p>{body}</p>{extra}</div>
    </div>
  );
  return (
    <section className="verify" aria-labelledby="vh">
      <h2 id="vh" className="sr-only">Check it yourself</h2>
      <p className="v-intro">Nothing below comes from the agents&apos; word. Your browser recomputes it from the cart.</p>
      {row(hashCheck ? hashCheck.mine === hashCheck.theirs : null, "The cart fingerprint is real",
        "Your browser hashed the cart (sorted keys, no spaces, SHA-256) and compared it with the fingerprint on the cheque.",
        hashCheck && <code><span>yours </span>{hashCheck.mine}<br /><span>theirs </span>{hashCheck.theirs}</code>)}
      {row(nonceCheck ? nonceCheck.mine.toLowerCase() === nonceCheck.theirs.toLowerCase() : null, "The signature is tied to this cart and recipient",
        "The wallet signed a nonce built from the cart fingerprint and the recipient. Your browser rebuilt it from those two values.",
        nonceCheck && <code><span>yours </span>{nonceCheck.mine}<br /><span>signed </span>{nonceCheck.theirs}</code>)}
      {settled && row(chain ? chain.ok : null, "The chain agrees",
        "Ask the settlement contract directly whether it holds a receipt for this cart.",
        <>
          <button className="btn quiet" onClick={readChain} disabled={busy} type="button" style={{ paddingLeft: 0 }}>{busy ? "Reading…" : "Read the receipt from the chain"}</button>
          {chain && <code>{chain.text}</code>}
        </>)}
    </section>
  );
}


// ---------- the approval sheet (what a wallet shows before you sign) ----------
interface Approval {
  merchant: string; memo: string; amount: string; payee: string; network: string; expires: string;
  balance?: string; enough: boolean;
}
function ApprovalSheet({ a, onApprove, onReject }: { a: Approval | null; onApprove: () => void; onReject: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (a && !d.open) d.showModal();
    if (!a && d.open) d.close();
  }, [a]);
  return (
    <dialog ref={ref} className="sheet" onCancel={(e) => { e.preventDefault(); onReject(); }} aria-labelledby="sheet-h">
      {a && (
        <div className="sheet-body">
          <div className="sheet-top"><h2 id="sheet-h">Approve this payment</h2><Pebble state="wide" size={84} label="The GROW pebble looks on" /></div>
          <p className="sheet-amt">${a.amount}<span> USDC</span></p>
          <dl className="sheet-rows">
            <div><dt>To</dt><dd>{a.merchant}<code>{a.payee}</code></dd></div>
            <div><dt>For</dt><dd>{a.memo}</dd></div>
            <div><dt>Network</dt><dd>{a.network}</dd></div>
            <div><dt>Valid for</dt><dd>15 minutes, then the signature is useless</dd></div>
            <div><dt>Gas</dt><dd>You pay none. The merchant sends the transaction.</dd></div>
            {a.balance !== undefined && <div><dt>Your balance</dt><dd>{a.balance} USDC{!a.enough && <strong className="bad"> (not enough)</strong>}</dd></div>}
          </dl>
          <p className="sheet-note">
            Your signature allows <b>one payment of exactly ${a.amount} to that address, for this cart only</b>. It cannot be reused, redirected or raised.
          </p>
          <div className="sheet-actions">
            <button className="btn" type="button" onClick={onApprove} disabled={!a.enough}>Sign and pay</button>
            <button className="btn quiet" type="button" onClick={onReject}>Reject</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;
const unitsOf = (usd: string) => { const [d, f = ""] = usd.split("."); return BigInt(d || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6)); };
const post = async <T,>(url: string, body: unknown): Promise<T> => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
};

// ---------- page ----------
export default function Page() {
  const [config, setConfig] = useState<Config | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"pay" | "tamper">("pay");
  const [service, setService] = useState("chain-pulse");
  const [target, setTarget] = useState("");
  const [demoKey, setDemoKey] = useState("");
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const endRef = useRef<HTMLLIElement | null>(null);
  const timers = useRef<number[]>([]);
  const [wallet, setWallet] = useState("");
  const [approval, setApproval] = useState<Approval | null>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((c: Config) => { setConfig(c); setTarget((t) => t || c.settler); }).catch(() => {});
    fetch("/runs/latest.json").then((r) => (r.ok ? r.json() : null)).then((j) => j && setRecorded(j)).catch(() => {});
    return () => timers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (phase === "running") endRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [events, phase]);

  const reset = () => { timers.current.forEach(clearTimeout); timers.current = []; setEvents([]); setError(""); };

  async function run(m: "pay" | "tamper") {
    reset(); setMode(m); setPhase("running");
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json", ...(demoKey ? { "x-demo-key": demoKey } : {}) },
        body: JSON.stringify({ mode: m, serviceId: service, target }),
      });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === "event") setEvents((p) => [...p, msg.event]);
          else if (msg.type === "done") { if (msg.summary?.meta) setMeta(msg.summary.meta); if (msg.summary?.error) setError(msg.summary.error); }
          else if (msg.type === "error") setError(msg.error);
        }
      }
    } catch (e) { setError((e as Error).message); }
    setPhase("done");
  }

  async function payWithWallet() {
    reset(); setMode("pay"); setPhase("running");
    const t0 = Date.now();
    let n = 0;
    const emit = (e: Omit<TraceEvent, "id" | "t">) => { const ev: TraceEvent = { ...e, id: ++n, t: Date.now() - t0 }; setEvents((p) => [...p, ev]); return ev; };
    try {
      const eth = window.ethereum;
      if (!eth) throw new Error("No browser wallet found. Install one (MetaMask, Rabby, Slush and others work) or use the agent buttons.");
      if (!config) throw new Error("The app is still loading. Try again in a moment.");
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const me = accounts[0] as Address;
      setWallet(me);
      const hexId = `0x${config.chainId.toString(16)}`;
      if (((await eth.request({ method: "eth_chainId" })) as string).toLowerCase() !== hexId) {
        try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] }); }
        catch {
          await eth.request({ method: "wallet_addEthereumChain", params: [{
            chainId: hexId, chainName: config.chainId === 177 ? "HashKey Chain" : config.chainId === 133 ? "HashKey Chain Testnet" : "Local test chain",
            nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 }, rpcUrls: [config.rpc], blockExplorerUrls: config.explorer ? [config.explorer] : undefined,
          }] });
        }
      }
      emit({ actor: "payer", status: "ok", title: "Wallet connected", detail: `You are paying as ${short(me, 8)}. Your keys never leave your wallet.` });

      const cart = await post<{ contents: Cart & Record<string, unknown> }>("/api/merchant/quote", { serviceId: service, target });
      const contents = cart.contents as Cart;
      const cartHash = await sha256Hex(JSON.stringify(sortKeys(contents)));
      const total = (contents.payment_request.details.total as unknown as { amount: { value: string } }).amount.value;
      const md = (contents.payment_request.method_data[0] as unknown as { data: { pay_to: Address; chain_id: number; contract_address: Address } }).data;
      if (md.chain_id !== config.chainId) throw new Error("The merchant's cart is for a different network than this page.");
      const memo = contents.payment_request.details.display_items?.[0]?.label ?? "";
      emit({
        actor: "merchant", status: "ok", hspState: "payment-required", title: "Cart Mandate issued",
        detail: `${memo} for $${total} USDC. Your browser recomputed the cart fingerprint itself.`,
        data: { cart_mandate_id: contents.id, cart_hash: cartHash, expires: contents.cart_expiry, pay_to: md.pay_to, cart: contents },
      });

      // what the wallet will show: your balance, read through your own wallet
      let balance: string | undefined; let enough = true;
      try {
        const pcw = createPublicClient({ transport: custom(eth) });
        const bal = (await pcw.readContract({ address: md.contract_address, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "balanceOf", args: [me] })) as bigint;
        balance = (Number(bal) / 1e6).toFixed(2); enough = bal >= unitsOf(total);
      } catch { /* balance is a convenience; the chain enforces it anyway */ }
      const ok = await new Promise<boolean>((resolve) => {
        decide.current = resolve;
        setApproval({
          merchant: contents.merchant_name, memo, amount: total, payee: md.pay_to, enough, balance,
          network: config.chainId === 177 ? "HashKey Chain" : config.chainId === 133 ? "HashKey Chain Testnet" : "Local test chain",
          expires: contents.cart_expiry,
        });
      });
      setApproval(null);
      if (!ok) { emit({ actor: "payer", status: "warn", title: "You rejected the payment", detail: "Nothing was signed and no funds moved." }); setPhase("done"); return; }

      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 900);
      const nonce = keccak256(encodeAbiParameters(
        [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }],
        ["GROWW.v1", BigInt(config.chainId), config.settler as Address, `0x${cartHash}` as Hex, md.pay_to],
      ));
      const wc = createWalletClient({ account: me, transport: custom(eth) });
      const signature = await wc.signTypedData({
        account: me, domain: config.domain, types: RECEIVE_TYPES, primaryType: "ReceiveWithAuthorization",
        message: { from: me, to: config.settler as Address, value: unitsOf(total), validAfter: 0n, validBefore, nonce },
      });
      emit({
        actor: "payer", status: "ok", hspState: "payment-submitted", title: "Payment Mandate signed",
        detail: "One wallet signature authorises exactly this cart: the cart hash and payee are inside the signed nonce.",
        data: { signer: me, amount_units: unitsOf(total).toString(), nonce, valid_for: "15 minutes", signature },
      });

      const sg = parseSignature(signature);
      const v = Number(sg.v ?? BigInt(27 + (sg.yParity ?? 0)));
      const paid = await post<{ txHash: string; blockNumber: string; gasUsed: string; explorerUrl?: string }>("/api/merchant/pay", {
        cart, payer: me, authorization: { validAfter: "0", validBefore: validBefore.toString(), v, r: sg.r, s: sg.s },
      });
      emit({ actor: "merchant", status: "ok", hspState: "payment-verified", title: "Mandate verified by dry-run", detail: "The chain confirmed the signature, cart, amount and payee line up before any gas was spent." });
      emit({
        actor: "chain", status: "ok", hspState: "payment-included", title: `Settled in block ${paid.blockNumber}`,
        detail: `Gas used ${paid.gasUsed}. You paid no gas; the merchant sent the transaction.`,
        data: { tx: paid.txHash, block: paid.blockNumber },
        links: paid.explorerUrl ? [{ label: "View transaction", href: paid.explorerUrl }] : undefined,
      });
      const delivery = await post<{ result: unknown; deliveryHash: string }>("/api/merchant/deliver", { cart, txHash: paid.txHash });
      emit({ actor: "merchant", status: "ok", hspState: "payment-finalized", title: "Service delivered", detail: "The merchant re-checked the settlement on chain before releasing the result.", data: { result: delivery.result, delivery_hash: delivery.deliveryHash } });
      setMeta({ network: config.network, chainId: config.chainId, settler: config.settler, token: config.token, explorer: config.explorer, payer: me, payTo: md.pay_to });
    } catch (e) {
      setApproval(null);
      const msg = (e as { code?: number; message?: string });
      emit({ actor: "payer", status: msg.code === 4001 ? "warn" : "fail", hspState: msg.code === 4001 ? undefined : "payment-failed", title: msg.code === 4001 ? "You declined in your wallet" : "Flow stopped", detail: msg.code === 4001 ? "Nothing was signed and no funds moved." : msg.message });
    }
    setPhase("done");
  }

  function replay() {
    if (!recorded) return;
    reset(); setMode(recorded.mode === "tamper" ? "tamper" : "pay"); setMeta(recorded.meta); setPhase("running");
    let acc = 0;
    recorded.events.forEach((ev, i) => {
      const prev = recorded.events[i - 1];
      acc += i === 0 ? 200 : Math.min(1300, Math.max(380, ev.t - prev.t));
      timers.current.push(window.setTimeout(() => {
        setEvents((p) => [...p, ev]);
        if (i === recorded.events.length - 1) setPhase("done");
      }, acc));
    });
  }

  const running = phase === "running";
  const needsTarget = service === "wallet-snapshot";
  const targetOk = !needsTarget || /^0x[a-fA-F0-9]{40}$/.test(target);
  const testNet = meta && meta.chainId !== 177;
  const root = useRef<HTMLDivElement | null>(null);
  const failed = events.some((e) => e.status === "fail");
  const declined = events.some((e) => e.status === "warn");
  const pebbleState: PebbleState = approval ? "wide" : phase === "running" ? "orbit" : phase === "done" ? (failed ? "alert" : declined ? "thinking" : "burst") : "idle";
  const [heroState, setHeroState] = useState<PebbleState>("idle");
  const [loading, setLoading] = useState(true);
  const [introGo, setIntroGo] = useState(false);

  // ---------- GSAP: every motion on the page ----------
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // top ticker
        gsap.to(".ticker-track", { xPercent: -50, duration: 28, ease: "none", repeat: -1 });

        // the hero starts hidden; its intro plays when the loader leaves (see the effect below)
        gsap.set([".hero-title .ch", ".hero-pills > *", ".hero-cta > *", ".sticker"], { autoAlpha: 0 });
        gsap.to(".swirl", { yPercent: 14, rotate: 4, scale: 1.1, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });

        const hero = root.current?.querySelector<HTMLElement>(".hero");
        const onMove = (e: MouseEvent) => {
          const r = hero!.getBoundingClientRect();
          const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
          gsap.to(".sticker-wrap", { x: (i, el) => nx * Number(el.dataset.depth ?? 30) * -1.6, y: (i, el) => ny * Number(el.dataset.depth ?? 30) * -1.6, duration: 0.9, ease: "power3.out" });
        };
        hero?.addEventListener("mousemove", onMove);

        // headings slam in as they scroll into view
        gsap.utils.toArray<HTMLElement>(".slam").forEach((el) => {
          gsap.from(el, { y: 110, skewY: 9, opacity: 0, duration: 0.9, ease: "power4.out", scrollTrigger: { trigger: el, start: "top 88%" } });
        });
        gsap.utils.toArray<HTMLElement>(".pop").forEach((el) => {
          gsap.from(el, { y: 70, rotate: -2, opacity: 0, duration: 0.8, ease: "back.out(1.6)", scrollTrigger: { trigger: el, start: "top 90%" } });
        });

        // marquees: opposite directions, shoved by scroll speed
        const rows = gsap.utils.toArray<HTMLElement>(".mq-track");
        const loops = rows.map((row, i) => gsap.fromTo(row, { xPercent: i % 2 ? -50 : 0 }, { xPercent: i % 2 ? 0 : -50, duration: 26 + i * 6, ease: "none", repeat: -1 }));
        ScrollTrigger.create({
          trigger: ".mq", start: "top bottom", end: "bottom top",
          onUpdate: (self) => {
            const v = Math.min(6, Math.abs(self.getVelocity()) / 400);
            loops.forEach((l) => gsap.to(l, { timeScale: 1 + v, duration: 0.2, overwrite: true }).then(() => gsap.to(l, { timeScale: 1, duration: 1 })));
            gsap.to(".mq-block", { skewX: self.getVelocity() / -300, duration: 0.3, overwrite: "auto" });
          },
        });

        return () => hero?.removeEventListener("mousemove", onMove);
      });

      // how it works: pinned, scrolls sideways on wide screens
      mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
        const track = root.current!.querySelector<HTMLElement>(".how-track")!;
        root.current!.querySelector(".how")!.classList.add("pinned");
        const dist = () => Math.max(0, track.scrollWidth - window.innerWidth + 48);
        gsap.to(track, { x: () => -dist(), ease: "none", scrollTrigger: { trigger: ".how", start: "top top", end: () => `+=${dist()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true } });
        return () => root.current?.querySelector(".how")?.classList.remove("pinned");
      });
    }, root);
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    return () => { window.removeEventListener("load", refresh); ctx.revert(); };
  }, []);

  // the loader: the pebble orbits, then bursts, then the page slides up
  const [loaderState, setLoaderState] = useState<PebbleState>("orbit");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setLoading(false); setIntroGo(true); return; }
    const t1 = window.setTimeout(() => setLoaderState("burst"), 1300);
    const t2 = window.setTimeout(() => {
      setIntroGo(true);
      gsap.to(".loader", { yPercent: -100, duration: 0.9, ease: "power4.inOut", onComplete: () => setLoading(false) });
    }, 2100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // hero intro: letters drop in, captions and buttons pop, stickers pop then float
  useEffect(() => {
    if (!introGo || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(".hero-title .ch", { yPercent: -140, rotate: () => gsap.utils.random(-28, 28), autoAlpha: 0 }, { yPercent: 0, rotate: 0, autoAlpha: 1, duration: 1.2, stagger: 0.12, ease: "elastic.out(1, 0.5)" });
      gsap.fromTo(".hero-pills > *", { y: 50, scale: 0.5, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.7, stagger: 0.16, delay: 0.7, ease: "back.out(2.2)" });
      gsap.fromTo(".hero-cta > *", { y: 30, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.6, stagger: 0.1, delay: 1.3, ease: "back.out(2)" });
      gsap.fromTo(".sticker", { scale: 0, rotate: -70, autoAlpha: 0 }, { scale: 1, rotate: 0, autoAlpha: 1, duration: 0.9, stagger: 0.12, delay: 0.3, ease: "back.out(2.2)", onComplete: () => {
        gsap.to(".sticker", { y: "+=14", rotate: "+=4", duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1, stagger: { each: 0.35, from: "random" } });
      } });
    }, root);
    return () => ctx.revert();
  }, [introGo]);

  // the hero pebble blinks a wink now and then
  useEffect(() => {
    const id = window.setInterval(() => { setHeroState("wink"); window.setTimeout(() => setHeroState("idle"), 1400); }, 6000);
    return () => clearInterval(id);
  }, []);

  // new tape entries slide in
  useEffect(() => {
    if (!events.length) return;
    const last = root.current?.querySelector(".tape .ev:last-of-type");
    if (last && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) gsap.from(last, { x: 70, opacity: 0, duration: 0.5, ease: "back.out(1.7)" });
  }, [events.length]);

  const net = config ? (config.network === "mainnet" ? "HashKey Chain mainnet" : config.network === "testnet" ? "HashKey Chain testnet" : "Local test chain") : "Connecting…";
  const ticker = ["G FOR GROW", "G FOR GOATED", "BE THE GREATEST OF ALL TIME", "SIGN ONCE", "VERIFY EVERYTHING"];
  const mq1 = ["G FOR GROW", "G FOR GOATED"], mq2 = ["GREATEST OF ALL TIME", "SIGN ONCE"];
  const colors = ["c-lilac", "c-blue", "c-yellow", "c-red", "c-white"];

  return (
    <div ref={root}>
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[0, 1].map((k) => <div className="ticker-set" key={k}>{Array.from({ length: 3 }).flatMap(() => ticker).map((t, i) => <span key={i}>{t}</span>)}</div>)}
        </div>
      </div>

      <div className="frame">
        <header className="hero">
          <div className="swirl gbd" aria-hidden="true" />
          <nav className="nav" aria-label="Main">
            <a className="logo" href="#top" aria-label="GROW home"><Logo /></a>
            <div className="nav-pills">
              <a href="#how">How it works</a>
              <a href="#try">Watch a demo</a>
              <a href="/dashboard">Dashboard</a>
              <a href="/docs">Docs</a>
              <span className="plus" aria-hidden="true">+</span>
              <a className="launch" href="/create">Get paid</a>
            </div>
          </nav>

          <div className="hero-body" id="top">
            <div className="sticker-wrap w1" data-depth="40"><div className="sticker"><Pebble state={heroState} follow size="100%" label="The GROW pebble follows your cursor" /></div></div>
            <div className="sticker-wrap w2" data-depth="55"><div className="sticker"><Coin /></div></div>
            <div className="sticker-wrap w3" data-depth="30"><div className="sticker"><Pen /></div></div>
            <div className="sticker-wrap w4" data-depth="45"><div className="sticker"><Stamp /></div></div>
            <div className="sticker-wrap w5" data-depth="35"><div className="sticker"><ChequeArt /></div></div>
            <h1 className="hero-title disp"><span className="row"><Letters text="GROW" /></span></h1>
            <div className="hero-pills">
              <p className="cap c-yellow">G for GROW.</p>
              <p className="cap c-lilac">G for GOATED.</p>
              <p className="cap c-white">Be the greatest of all time.</p>
            </div>
            <div className="hero-cta">
              <a className="pill yellow" href="/create">Get paid</a>
              <a className="pill white" href="#try">Watch a demo</a>
            </div>
          </div>
        </header>

        <section className="how" id="how" aria-labelledby="how-h">
          <div className="how-inner">
            <h2 id="how-h" className="disp slam">One signature. <span className="skew">Four steps.</span></h2>
            <p className="lead how-lead">GROW lets an AI agent pay another AI agent. You sign once, and you can check every step yourself.</p>
            <div className="how-track">
              {[
                { c: "c-yellow", art: <Stamp />, h: "The merchant agent quotes.", t: "It issues a cart: what you are buying, the price, and who gets paid. The cart is signed with the merchant's own key and fingerprinted, so any edit shows." },
                { c: "c-lilac", art: <Pebble state="thinking" size="100%" label="The GROW pebble thinks" />, h: "Your agent checks the rules.", t: "Is the signature real? Is the price under the spending cap? Has the quote expired? If anything is off, your agent walks away and signs nothing." },
                { c: "c-blue", art: <Pen />, h: "One signature.", t: "Your wallet signs a single message that covers this cart, this recipient and this amount. It is useless for anything else, and it expires in 15 minutes." },
                { c: "c-green", art: <Lock />, h: "The chain settles. You verify.", t: "The contract pays the merchant and records a receipt for the cart. Your browser then recomputes the fingerprint and checks the receipt itself." },
              ].map((s, i) => (
                <article key={i} className={`step ${s.c}`}>
                  <span className="step-n disp">{i + 1}</span>
                  <div className="step-art">{s.art}</div>
                  <h3 className="disp">{s.h}</h3>
                  <p>{s.t}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="try" id="try" aria-labelledby="try-h">
          <h2 id="try-h" className="disp slam">Run a payment.</h2>
          <p className="lead pop">Pick something for the agent to buy. Then watch the cheque fill itself in, step by step.</p>

          <div className="controls pop" aria-label="Run the agents">
            <fieldset className="pick">
              <legend>What should the payer buy?</legend>
              {SERVICES.map((s) => (
                <label key={s.id}>
                  <input type="radio" name="svc" value={s.id} checked={service === s.id} onChange={() => setService(s.id)} disabled={running} />
                  <span className="t">{s.title} <b>{s.price}</b></span>
                  <span className="d">{s.note}</span>
                </label>
              ))}
            </fieldset>

            {needsTarget && (
              <div className="field">
                <label htmlFor="target">Address to look up</label>
                <input id="target" value={target} onChange={(e) => setTarget(e.target.value.trim())} spellCheck={false} autoComplete="off" aria-invalid={!targetOk} disabled={running} />
                {!targetOk && <small>Enter a full 0x address (42 characters).</small>}
              </div>
            )}
            {config?.liveNeedsKey && (
              <div className="field">
                <label htmlFor="dk">Demo key</label>
                <input id="dk" type="password" value={demoKey} onChange={(e) => setDemoKey(e.target.value)} autoComplete="off" disabled={running} />
                <small>Live runs spend real USDC, so this deployment asks for a key. Replaying a recorded run needs none.</small>
              </div>
            )}

            <div className="actions">
              <button className="pill black" type="button" onClick={() => run("pay")} disabled={running || !targetOk}>Pay with the agent</button>
              <button className="pill blue" type="button" onClick={payWithWallet} disabled={running || !targetOk || !config}>Pay with my wallet</button>
              <button className="pill white" type="button" onClick={replay} disabled={running || !recorded}>{recorded ? "Replay last run" : "No recorded run yet"}</button>
            </div>
            <p className="netline">{wallet && <span className="chip" title={wallet}>{short(wallet, 4)}</span>} {net}{config && config.settler && !/^0x0+$/.test(config.settler) && <> · contract {config.explorer ? <a href={`${config.explorer}/address/${config.settler}`} target="_blank" rel="noreferrer">{short(config.settler, 5)}</a> : short(config.settler, 5)}</>}</p>
            {error && <p className="notice bad" role="alert">{error}</p>}
            {testNet && <p className="notice">This run used a test network (chain {meta.chainId}), not HashKey Chain mainnet. Nothing here moved real money.</p>}
          </div>

          <div className="stage">
            <Cheque events={events} mode={mode} />
            <Tape events={events} phase={phase} endRef={endRef} pebble={pebbleState} />
          </div>
        </section>

        <section className="cheat" id="cheat" aria-labelledby="cheat-h">
          <div className="cheat-art"><Pebble state="alert" size="100%" label="The GROW pebble on alert" /></div>
          <div className="cheat-copy">
            <h2 id="cheat-h" className="disp slam">Try to <span className="skew">cheat it.</span></h2>
            <p className="lead pop">Redirect the money. Raise the price. Reuse the signature on another cart. Pretend to be the payer. The contract checks all four against the real chain and refuses every one. No funds move.</p>
            <button className="pill black big" type="button" onClick={() => { document.getElementById("try")?.scrollIntoView({ behavior: "smooth" }); void run("tamper"); }} disabled={running}>Try to cheat</button>
          </div>
        </section>

        <section className="check" id="check" aria-labelledby="check-h">
          <h2 id="check-h" className="disp slam">Check it yourself.</h2>
          {meta && events.length > 0
            ? <Verify events={events} meta={meta} config={config} />
            : <p className="lead pop">Run a payment above. Your browser will then rebuild the cart fingerprint and the signed nonce on its own, and you can ask the chain for the receipt directly.</p>}
        </section>

        <section className="mq" aria-hidden="true">
          {[mq1, mq2].map((row, r) => (
            <div className="mq-row" key={r}>
              <div className="mq-track">
                {[0, 1].map((k) => (
                  <div className="mq-set" key={k}>
                    {Array.from({ length: 3 }).flatMap(() => row).map((t, i) => (
                      <span key={i} className="mq-item">
                        <span className={`mq-block disp ${colors[(i + r * 2) % colors.length]}`}>{t}</span>
                        <span className="mq-coin"><GCoin /></span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <footer className="foot" id="about">
          <div className="foot-card">
            <div className="foot-pebble"><Pebble state="wink" follow size="100%" label="The GROW pebble winks" /></div>
            <h2 className="disp">G for goated. <span className="skew">Be the greatest of all time.</span></h2>
            <div className="foot-cols">
              <p>GROW is our entry for HSK Chain Horizon · India, Track 2. The cart follows the HashKey Settlement Protocol&apos;s Cart Mandate format. Payment settles straight on HashKey Chain through one contract. The HSP gateway rail needs merchant credentials and is not connected in this demo. The pebble character runs on the MIT-licensed bloub animation engine by Jérémy Perret.</p>
              <ul>
                <li><a href="/create">Create a pay link</a></li>
                <li><a href="/dashboard">Dashboard</a></li>
                <li><a href="/docs">Docs</a></li>
                <li><a href="#how">How it works</a></li>
                <li><a href="#try">Watch a demo</a></li>
                <li><a href="#cheat">Cheat it</a></li>
                <li><a href="#check">Check it</a></li>
                {config?.explorer && <li><a href={`${config.explorer}/address/${config.settler}`} target="_blank" rel="noreferrer">The contract</a></li>}
                <li><a href="https://dorahacks.io/hackathon/hskchainindia/detail" target="_blank" rel="noreferrer">The hackathon</a></li>
              </ul>
            </div>
          </div>
        </footer>
      </div>

      {loading && (
        <div className="loader" role="status" aria-label="Loading GROW">
          <Pebble state={loaderState} size={210} label="The GROW pebble loading" />
          <p className="loader-word disp">GROW</p>
        </div>
      )}

      <ApprovalSheet a={approval} onApprove={() => decide.current?.(true)} onReject={() => decide.current?.(false)} />
    </div>
  );
}
