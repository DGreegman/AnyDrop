import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request CSP with a nonce, following Next.js's documented pattern
 * (https://nextjs.org/docs/app/guides/content-security-policy). Next.js
 * reads the nonce back off the CSP response header and applies it to the
 * inline hydration/RSC bootstrap scripts it injects itself — a static
 * `script-src 'self'` (no nonce, no 'unsafe-inline') blocks those and the
 * app never hydrates.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // React's dev-mode Fast Refresh/debugging tooling uses eval() for source
  // mapping — never in production, so only relax this locally.
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self'",
    // Service worker registration (public/sw.js, for PWA installability)
    // falls back through worker-src, not the nonce'd script-src rules.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Only pages render scripts that need a CSP nonce — skip API routes and
    // static assets.
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
