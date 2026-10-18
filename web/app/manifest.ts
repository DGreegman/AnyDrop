import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AnyDrop",
    short_name: "AnyDrop",
    description: "Download videos from public X, Instagram, TikTok and Facebook posts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Web Share Target: once installed (Android Chrome/Edge/Samsung
    // Internet — iOS doesn't support share targets for web apps), AnyDrop
    // shows up in the system share sheet. Sharing opens
    // /?title=…&text=…&url=… — HomeClient reads all three, since apps
    // disagree about which one carries the link (many put it in `text`,
    // surrounded by other words).
    // Lets Chrome on Android tell a normal browser tab that AnyDrop is
    // already installed (navigator.getInstalledRelatedApps, used by
    // InstallPrompt.tsx). Relative — resolved against the manifest's own
    // URL, so it's right on every deployment/domain.
    related_applications: [{ platform: "webapp", url: "/manifest.webmanifest" }],
    share_target: {
      action: "/",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
