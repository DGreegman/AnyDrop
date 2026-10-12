import { AppError } from "../errors";

// e.g. /someuser/status/1234567890123456789 (optionally .../video/2 etc.)
const STATUS_PATH_RE = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)(?:\/.*)?$/;
// Links X itself generates without a handle: /i/web/status/<id> (from
// the web app's share menu) and /i/status/<id>.
const HANDLELESS_STATUS_PATH_RE = /^\/i\/(?:web\/)?status\/(\d+)(?:\/.*)?$/;

/**
 * X-specific: confirms the URL is actually a status/post URL (not e.g.
 * x.com/settings) and normalizes it to a canonical
 * https://x.com/<user>/status/<id> form (or /i/status/<id> when the link
 * carries no handle), so the resolver always sees the same shape
 * regardless of which hostname variant (x.com/twitter.com, www./mobile.,
 * the fxtwitter-style embed mirrors) or trailing path segments the user
 * pasted. Idempotent: normalizing a canonical URL returns it unchanged
 * (passthrough.ts relies on that).
 *
 * Assumes `url` is already a well-formed http(s) URL on an X hostname —
 * platform-detector.ts guarantees that before this is ever called.
 */
export function normalizeXUrl(url: string): string {
  const parsed = new URL(url);

  const handleless = parsed.pathname.match(HANDLELESS_STATUS_PATH_RE);
  if (handleless) {
    return `https://x.com/i/status/${handleless[1]}`;
  }

  const match = parsed.pathname.match(STATUS_PATH_RE);
  if (!match) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "The URL does not look like a post (expected /<user>/status/<id>)."
    );
  }

  const [, user, statusId] = match;
  return `https://x.com/${user}/status/${statusId}`;
}

/** The numeric status id from a canonical X URL. */
export function xStatusId(canonicalUrl: string): string | undefined {
  return canonicalUrl.match(/\/status\/(\d+)$/)?.[1];
}
