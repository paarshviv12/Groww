import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/anton/400.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "GROW: G for goated",
  description: "GROW lets an AI agent pay another AI agent on HashKey Chain. One signature covers the cart, the recipient and the price, so nothing can be changed on the way.",
};
export const viewport: Viewport = { themeColor: "#DDE9E4", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
