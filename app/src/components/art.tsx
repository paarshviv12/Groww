// Original sticker artwork for GROW: flat fills, thick black outlines.
import type { ReactNode } from "react";

const S = { stroke: "#000", strokeWidth: 5, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const Wrap = ({ children, label }: { children: ReactNode; label: string }) => (
  <svg viewBox="0 0 120 120" role="img" aria-label={label} className="sticker-svg">{children}</svg>
);

export const Robot = () => (
  <Wrap label="A friendly robot agent">
    <g {...S}>
      <line x1="60" y1="12" x2="60" y2="28" /><circle cx="60" cy="11" r="7" fill="#FF4A1C" />
      <rect x="8" y="50" width="13" height="28" rx="6" fill="#FFD22E" /><rect x="99" y="50" width="13" height="28" rx="6" fill="#FFD22E" />
      <rect x="18" y="28" width="84" height="72" rx="24" fill="#E1C4FF" />
      <circle cx="42" cy="58" r="11" fill="#fff" /><circle cx="78" cy="58" r="11" fill="#fff" />
      <circle cx="45" cy="60" r="4" fill="#000" /><circle cx="75" cy="60" r="4" fill="#000" />
      <path d="M40 82 Q60 94 80 82" fill="none" />
    </g>
  </Wrap>
);

export const Pen = () => (
  <Wrap label="A fountain pen">
    <g {...S}>
      <path d="M16 104 L32 66 L84 14 L106 36 L54 88 Z" fill="#2F6BFF" />
      <path d="M16 104 L32 66 L54 88 Z" fill="#FFD22E" />
      <path d="M84 14 L94 6 L114 26 L106 36 Z" fill="#fff" />
      <line x1="16" y1="104" x2="30" y2="90" />
    </g>
  </Wrap>
);

export const Stamp = () => (
  <Wrap label="A rubber stamp">
    <g {...S}>
      <rect x="40" y="8" width="40" height="50" rx="16" fill="#FF4A1C" />
      <rect x="28" y="56" width="64" height="18" rx="5" fill="#FFD22E" />
      <rect x="16" y="80" width="88" height="26" rx="5" fill="#fff" />
      <line x1="28" y1="93" x2="92" y2="93" />
    </g>
  </Wrap>
);

export const Lock = () => (
  <Wrap label="A padlock">
    <g {...S}>
      <path d="M36 54 V40 a24 24 0 0 1 48 0 V54" fill="none" strokeWidth={10} />
      <path d="M36 54 V40 a24 24 0 0 1 48 0 V54" fill="none" stroke="#fff" strokeWidth={0} />
      <rect x="20" y="52" width="80" height="58" rx="16" fill="#3DD68C" />
      <circle cx="60" cy="78" r="8" fill="#000" /><line x1="60" y1="82" x2="60" y2="96" />
    </g>
  </Wrap>
);

export const Coin = () => (
  <Wrap label="A dollar coin">
    <g {...S}>
      <circle cx="60" cy="60" r="48" fill="#FFD22E" />
      <circle cx="60" cy="60" r="34" fill="#FFE97A" />
      <path d="M30 40 Q38 28 52 24" fill="none" stroke="#fff" strokeWidth={6} />
    </g>
    <text x="60" y="80" textAnchor="middle" fontSize="58" fontFamily="Anton, Impact, sans-serif" fill="#000">$</text>
  </Wrap>
);

export const Cheque = () => (
  <Wrap label="A flying cheque">
    <g {...S}>
      <rect x="10" y="28" width="100" height="62" rx="8" fill="#fff" transform="rotate(-10 60 60)" />
      <g transform="rotate(-10 60 60)">
        <line x1="22" y1="48" x2="70" y2="48" /><line x1="22" y1="62" x2="52" y2="62" />
        <rect x="76" y="40" width="24" height="16" rx="3" fill="#B8D4FF" />
        <path d="M60 78 q6 -14 12 0 t12 0 t12 0" fill="none" stroke="#2F6BFF" />
      </g>
    </g>
  </Wrap>
);

/** The round logo mark: a bold G in a circle. */
export const Logo = () => (
  <svg viewBox="0 0 48 48" role="img" aria-label="GROW" width="100%" height="100%">
    <circle cx="24" cy="24" r="21" fill="#fff" stroke="#000" strokeWidth="3" />
    <text x="24" y="35.5" textAnchor="middle" fontSize="33" fontFamily="Anton, Impact, sans-serif" fill="#000">G</text>
  </svg>
);

/** A round G badge for the marquee. */
export const GCoin = () => (
  <svg viewBox="0 0 120 120" aria-hidden="true" width="100%" height="100%">
    <circle cx="60" cy="60" r="52" fill="#FFD22E" stroke="#000" strokeWidth="6" />
    <text x="60" y="88" textAnchor="middle" fontSize="86" fontFamily="Anton, Impact, sans-serif" fill="#000">G</text>
  </svg>
);

/** A thick, textured blue tube across the hero, drawn with an SVG lighting filter. */
export function Swirl() {
  const d = "M -120 760 C 160 980, 420 420, 700 560 S 1100 920, 1300 560 S 1500 120, 1620 260";
  return (
    <svg className="swirl" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="bump" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="7" result="n" />
          <feDiffuseLighting in="n" lightingColor="#D6E6FF" surfaceScale="7" result="l"><feDistantLight azimuth="225" elevation="58" /></feDiffuseLighting>
          <feComposite in="l" in2="SourceGraphic" operator="in" result="t" />
          <feBlend in="t" in2="SourceGraphic" mode="multiply" />
        </filter>
      </defs>
      <path d={d} fill="none" stroke="#0F3FD6" strokeWidth="210" strokeLinecap="round" filter="url(#bump)" />
      <path d={d} fill="none" stroke="#3E86FF" strokeWidth="150" strokeLinecap="round" opacity="0.55" transform="translate(-18 -22)" />
      <path d={d} fill="none" stroke="#9CC9FF" strokeWidth="26" strokeLinecap="round" opacity="0.5" transform="translate(-52 -60)" />
    </svg>
  );
}
