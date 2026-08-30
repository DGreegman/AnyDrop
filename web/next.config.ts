import type { NextConfig } from "next";

// Security headers (Helmet-equivalent for Next.js — see architecture doc
// §10, §13). Frontend and API share one origin here, so there's no CORS
// surface to configure at all. Content-Security-Policy is set per-request
// in middleware.ts instead (it needs a fresh nonce per request).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  outputFileTracingIncludes: {
    // Next's build-time file tracer can't see a runtime spawn(binaryPath)
    // call, so the bundled yt-dlp binary has to be declared explicitly or
    // it won't ship with these routes' serverless function on Vercel.
    "/api/videos/resolve": ["./bin/**"],
    "/api/videos/download": ["./bin/**"],
  },
};

export default nextConfig;
