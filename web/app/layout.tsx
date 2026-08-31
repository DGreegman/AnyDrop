import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import RegisterSW from "./RegisterSW";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "XDrop",
  description: "Paste a public X (Twitter) post URL to fetch and download its video.",
  appleWebApp: { title: "XDrop", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // suppressHydrationWarning below is scoped to this element only (not
  // descendants) — it silences the harmless mismatch some browser
  // extensions cause by injecting attributes onto <html> before React
  // hydrates (e.g. observed: a `data-qb-installed` attribute). It won't
  // hide a real hydration bug elsewhere in the tree.
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
