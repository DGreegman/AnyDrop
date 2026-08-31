import { AppError } from "../errors";

// e.g. /@natgeo/video/7595589117723954487 — TikTok usernames allow
// letters, digits, underscore, and period.
const VIDEO_PATH_RE = /^\/@([A-Za-z0-9_.]+)\/video\/(\d+)/;

const SHORT_LINK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

/**
 * TikTok-specific: confirms the URL is actually a video URL and
 * normalizes it to a canonical https://www.tiktok.com/@<user>/video/<id>
 * form — except for short links (vm.tiktok.com/vt.tiktok.com), which
 * carry an opaque per-share code with no reliable path shape to validate
 * or canonicalize. Those are passed through unchanged: yt-dlp's TikTok
 * extractor follows the redirect and extracts the real video internally
 * (verified against two real, live short links) — there's no benefit to
 * XDrop pre-resolving the redirect itself, and doing so would just be a
 * second network round-trip for the same result.
 *
 * Assumes `url` is already a well-formed http(s) URL on a TikTok
 * hostname — platform-detector.ts guarantees that before this is ever
 * called.
 */
export function normalizeTikTokUrl(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();

  if (SHORT_LINK_HOSTS.has(host)) {
    if (parsed.pathname === "" || parsed.pathname === "/") {
      throw new AppError("UNSUPPORTED_URL", "This doesn't look like a TikTok share link.");
    }
    return `https://${host}${parsed.pathname}`;
  }

  const match = parsed.pathname.match(VIDEO_PATH_RE);
  if (!match) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "The URL does not look like a TikTok video (expected /@<user>/video/<id>)."
    );
  }

  const [, username, id] = match;
  return `https://www.tiktok.com/@${username}/video/${id}`;
}
