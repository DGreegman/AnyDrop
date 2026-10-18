import { AppError } from "../errors";

// e.g. /@natgeo/video/7595589117723954487 — TikTok usernames allow
// letters, digits, underscore, and period. The username may also be
// empty ("/@/video/<id>"): that's where TikTok's own legacy
// m.tiktok.com/v/<id>.html links redirect to (verified), and yt-dlp
// resolves it fine (verified against a real video).
const VIDEO_PATH_RE = /^\/@([A-Za-z0-9_.]*)\/video\/(\d+)/;
// Other video-id-carrying shapes TikTok links use, all reducible to the
// same canonical /@<user>/video/<id> form without a network round-trip:
//   /v/<id>.html          legacy m.tiktok.com share links
//   /share/video/<id>     older in-app share links
//   /embed/<id>, /embed/v2/<id>
const ID_ONLY_PATH_RES = [
  /^\/v\/(\d+)(?:\.html)?/,
  /^\/share\/video\/(\d+)/,
  /^\/embed\/(?:v2\/)?(\d+)/,
];
// Photo slideshows. yt-dlp's TikTok extractor doesn't support them (its
// URL pattern only covers /video/), so they get an honest, specific error.
const PHOTO_PATH_RE = /^\/@[A-Za-z0-9_.]*\/photo\/\d+/;

const SHORT_LINK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
// www.tiktok.com/t/<code> is the third short-link form (yt-dlp's
// TikTokVM extractor handles all three).
const T_SHORT_PATH_RE = /^\/t\/[A-Za-z0-9_-]+\/?$/;

/**
 * TikTok-specific: confirms the URL is actually a video URL and
 * normalizes it to a canonical https://www.tiktok.com/@<user>/video/<id>
 * form — except for short links (vm./vt.tiktok.com/<code>,
 * www.tiktok.com/t/<code>), which carry an opaque per-share code with no
 * reliable path shape to canonicalize. Those are passed through
 * unchanged: yt-dlp's TikTok extractor follows the redirect and extracts
 * the real video internally (verified against two real, live short
 * links) — there's no benefit to AnyDrop pre-resolving the redirect itself.
 * Idempotent (passthrough.ts relies on that).
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

  if (T_SHORT_PATH_RE.test(parsed.pathname)) {
    return `https://www.tiktok.com${parsed.pathname}`;
  }

  if (PHOTO_PATH_RE.test(parsed.pathname)) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "TikTok photo slideshows aren't supported yet — only videos."
    );
  }

  const match = parsed.pathname.match(VIDEO_PATH_RE);
  if (match) {
    const [, username, id] = match;
    return `https://www.tiktok.com/@${username}/video/${id}`;
  }

  for (const re of ID_ONLY_PATH_RES) {
    const idMatch = parsed.pathname.match(re);
    if (idMatch) return `https://www.tiktok.com/@/video/${idMatch[1]}`;
  }

  throw new AppError(
    "UNSUPPORTED_URL",
    "The URL does not look like a TikTok video (expected /@<user>/video/<id>)."
  );
}

/** The numeric video id from a canonical TikTok URL (not available for short links). */
export function tiktokVideoId(canonicalUrl: string): string | undefined {
  return canonicalUrl.match(/\/video\/(\d+)$/)?.[1];
}
