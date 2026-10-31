"use client";
import { useState } from "react";
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn quiet" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : label}</button>
  );
}
