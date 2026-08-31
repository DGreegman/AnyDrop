import { AppError } from "../errors";

// e.g. /someuser/status/1234567890123456789
const STATUS_PATH_RE = /^\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d+)(?:\/.*)?$/;

/**
 * X-specific: confirms the URL is actually a status/post URL (not e.g.
 * x.com/settings) and normalizes it to a canonical
 * https://x.com/<user>/status/<id> form, so the resolver always sees the
 * same shape regardless of which hostname variant (x.com/twitter.com,
 * www./mobile.) or trailing path segments the user pasted.
 *
 * Assumes `url` is already a well-formed http(s) URL on an X hostname —
 * platform-detector.ts guarantees that before this is ever called.
 */
export function normalizeXUrl(url: string): string {
  const parsed = new URL(url);
  const match = parsed.pathname.match(STATUS_PATH_RE);
  if (!match) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "The URL does not look like a post (expected /<user>/status/<id>)."
    );
  }

  const user = parsed.pathname.split("/")[1];
  const statusId = match[1];
  return `https://x.com/${user}/status/${statusId}`;
}
