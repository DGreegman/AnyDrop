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
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
