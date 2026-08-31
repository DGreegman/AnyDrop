import os from "os";
import type { NextConfig } from "next";

// Security headers (Helmet-equivalent for Next.js — see architecture doc
// §10, §13). Frontend and API share one origin here, so there's no CORS
// surface to configure at all. Content-Security-Policy is set per-request
// in proxy.ts instead (it needs a fresh nonce per request).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/**
 * `next dev` refuses cross-origin requests for its own JS chunks/HMR
 * socket by default (a real security guard, not a bug) — so opening the
 * dev server from another device on the LAN (e.g. testing on a phone via
 * `http://<this machine's IP>:3000`) loads the HTML fine but silently
 * fails to hydrate: React never attaches, so typing/pasting only updates
 * the raw DOM, not component state (a controlled input's value looks
 * right, but things like a submit button's `disabled` check — driven by
 * state — never update). Auto-detect this machine's own LAN IPs instead
 * of hardcoding one, so it keeps working across networks/reconnects.
 * Irrelevant in production (Vercel doesn't run `next dev`).
 */
function localNetworkOrigins(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: localNetworkOrigins(),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  outputFileTracingIncludes: {
    // Next's build-time file tracer can't see a runtime spawn(binaryPath)
    // call, so the bundled yt-dlp binary has to be declared explicitly or
    // it won't ship with these routes' serverless function on Vercel.
    // Both the generic /api/media/resolve and the legacy /api/videos/resolve
    // shim end up calling XVideoResolver (which spawns yt-dlp) via
    // MediaService, so both need it. The download routes don't spawn
    // anything (they only fetch()), but are included too for symmetry —
    // cheap, and avoids this silently going stale if that ever changes.
    "/api/media/resolve": ["./bin/**"],
    "/api/media/download": ["./bin/**"],
    "/api/videos/resolve": ["./bin/**"],
    "/api/videos/download": ["./bin/**"],
  },
};

export default nextConfig;
