import type { Metadata, Viewport } from "next";
import RegisterSW from "./RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "XDrop",
  description: "Paste a public X (Twitter) post URL to fetch and download its video.",
  appleWebApp: { title: "XDrop", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0f1419",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
