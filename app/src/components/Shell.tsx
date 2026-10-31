import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/art";

export function Shell({ children, active }: { children: ReactNode; active?: "create" | "docs" | "dashboard" }) {
  const item = (href: string, label: string, key?: string) => (
    <Link href={href} className={active && active === key ? "on" : undefined}>{label}</Link>
  );
  return (
    <div className="ap-root">
      <div className="frame">
        <header className="ap-head">
          <Link className="logo" href="/" aria-label="GROWW home"><Logo /></Link>
          <nav className="ap-nav" aria-label="Main">
            {item("/create", "Create a link", "create")}
            {item("/dashboard", "Dashboard", "dashboard")}
            {item("/docs", "Docs", "docs")}
            <Link href="/" className="home">Home</Link>
          </nav>
        </header>
        {children}
        <footer className="ap-foot">
          <span>GROWW · G for goated. Be the greatest of all time.</span>
          <span>One signature. One cart. Settled on HashKey Chain.</span>
        </footer>
      </div>
    </div>
  );
}
