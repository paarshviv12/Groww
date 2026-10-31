/** Splits text into per-letter spans so GSAP can animate each one. */
export function Letters({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) => (
        <span key={i} className="ch" aria-hidden="true">{c === " " ? " " : c}</span>
      ))}
      <span className="sr-only">{text}</span>
    </>
  );
}
