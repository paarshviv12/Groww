"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NOTIF_BLUE } from "@/lib/pebble/decor";
import { BotEngine, type BotFrame } from "@/lib/pebble/engine";
import { lookTarget, TURN_TIME } from "@/lib/pebble/gaze";
import { clamp, easings } from "@/lib/pebble/math";
import { DEMI_VIEWBOX, RAYON } from "@/lib/pebble/repere";
import { SHAPE_BY_ID, mixHex } from "@/lib/pebble/skins";
import { STATE_BY_ID, type StateId } from "@/lib/pebble/states";

export type PebbleState = StateId;

interface Props {
  state?: PebbleState;
  /** pixels, or a CSS length such as "100%" */
  size?: number | string;
  /** body colour */
  ink?: string;
  /** colour of the eyes (what shows through the holes) */
  paper?: string;
  shape?: string;
  /** the eyes follow the pointer */
  follow?: boolean;
  outline?: boolean;
  label?: string;
  className?: string;
}

const R = RAYON;
const VB = DEMI_VIEWBOX;

/**
 * Our character: bloub's engine drawing the "galet" (pebble) body. The engine is a pure function
 * of time, so this component only keeps a clock and asks it for a frame.
 */
export function Pebble({ state = "idle", size = 200, ink = "#FFD22E", paper = "#FFFFFF", shape = "galet", follow = false, outline = true, label = "GROW, the pebble", className }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const radii = SHAPE_BY_ID.get(shape)?.radii ?? null;
  const engine = useRef<BotEngine | null>(null);
  if (!engine.current) engine.current = new BotEngine(R, state, radii, null);
  const [frame, setFrame] = useState<BotFrame>(() => engine.current!.sample(0));
  const svg = useRef<SVGSVGElement | null>(null);
  const clock = useRef(0);
  const current = useRef(state);
  const visible = useRef(true);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  // state changes: the engine blends from the previous one
  useEffect(() => {
    current.current = state;
    engine.current!.setState(state, clock.current);
  }, [state]);

  useEffect(() => {
    const eng = engine.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // one still frame, no loop
      setFrame(eng.sample(clock.current + 1.2));
      return;
    }
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; });
    if (svg.current) io.observe(svg.current);

    const onMove = (ev: PointerEvent) => { if (ev.pointerType !== "touch") pointer.current = { x: ev.clientX, y: ev.clientY }; };
    const onLeave = () => { pointer.current = null; };
    if (follow) {
      window.addEventListener("pointermove", onMove);
      document.addEventListener("pointerleave", onLeave);
    }

    let raf = 0, last = 0, turnSince = 0, aiming = false;
    const aim = () => {
      if (!STATE_BY_ID.get(current.current)?.baseFace) {
        if (aiming) { eng.setLook(null, clock.current, TURN_TIME); aiming = false; }
        return;
      }
      const box = svg.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      if (!aiming) turnSince = clock.current;
      const hw = Math.max(1, window.innerWidth / 2), hh = Math.max(1, window.innerHeight / 2), p = pointer.current;
      eng.setLook(lookTarget({
        nx: p ? clamp((p.x - (box.left + box.width / 2)) / hw, -1, 1) : 0,
        ny: p ? clamp((p.y - (box.top + box.height / 2)) / hh, -1, 1) : 0,
        tour: easings.easeOutQuint(clamp((clock.current - turnSince) / TURN_TIME)),
        pointer: p !== null,
      }), clock.current);
      aiming = true;
    };
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      if (!visible.current) return; // off screen: no work
      clock.current += dt;
      if (follow) aim();
      setFrame(eng.sample(clock.current));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [follow]);

  const dot = (d: BotFrame["dots"][number]) => {
    const fill = d.color ?? (d.depth === undefined ? ink : mixHex(paper, ink, d.depth));
    return d.d
      ? { fill, opacity: d.opacity, d: d.d, transform: `translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${R})` }
      : { fill, opacity: d.opacity, cx: d.x, cy: d.y, r: d.r };
  };
  const Dot = ({ d, k }: { d: BotFrame["dots"][number]; k: string }) => (d.d ? <path key={k} {...dot(d)} /> : <circle key={k} {...dot(d)} />);

  return (
    <svg ref={svg} width={size} height={size} viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`} role="img" aria-label={label} className={className} style={{ overflow: "visible" }}>
      <defs>
        <mask id={`m${uid}`} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((e, i) => <path key={i} d={e.d} transform={e.matrix} opacity={e.alpha} fill="#000" />)}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((a) => (
          <linearGradient key={a.id} id={`${uid}${a.id}`} gradientUnits="userSpaceOnUse" x1={a.grad.x1} y1={a.grad.y1} x2={a.grad.x2} y2={a.grad.y2}>
            {a.grad.stops.map((c, i) => <stop key={i} offset={i / (a.grad.stops.length - 1)} stopColor={c} />)}
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((a) => <path key={`b${a.id}`} d={a.back} stroke={`url(#${uid}${a.id})`} strokeWidth={a.width} opacity={a.opacity} />)}
      </g>
      {frame.dotsBehind && <g>{frame.dots.map((d, i) => <Dot key={i} k={`pb${i}`} d={d} />)}</g>}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#m${uid})`}><rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} /></g>
        {outline && <path d={frame.bodyPath} fill="none" stroke="#0a0a0a" strokeWidth={7} strokeLinejoin="round" />}
      </g>
      {!frame.dotsBehind && <g>{frame.dots.map((d, i) => <Dot key={i} k={`pf${i}`} d={d} />)}</g>}
      {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((a) => <path key={`f${a.id}`} d={a.front} stroke={`url(#${uid}${a.id})`} strokeWidth={a.width} opacity={a.opacity} />)}
      </g>
    </svg>
  );
}
