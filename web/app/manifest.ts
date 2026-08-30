import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XDrop",
    short_name: "XDrop",
    description: "Paste a public X (Twitter) post URL to fetch and download its video.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f1419",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
