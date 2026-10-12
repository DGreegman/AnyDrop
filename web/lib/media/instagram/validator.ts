import { AppError } from "../errors";

// Instagram post URLs XDrop handles, each optionally prefixed with the
// author's username (Instagram links both ways):
//   /reel/<shortcode>/    /reels/<shortcode>/   Reels
//   /p/<shortcode>/                             regular posts (single
//                                               video or a carousel)
//   /tv/<shortcode>/                            legacy IGTV
// Same set yt-dlp's Instagram extractor accepts. Shortcodes are
// URL-safe-base64-alphabet strings; length varies in practice.
const POST_PATH_RE = /^\/(?:[A-Za-z0-9_.]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Instagram-specific: confirms the URL is a post Instagram serves to
 * logged-out visitors and normalizes it to a canonical
 * https://www.instagram.com/<reel|p|tv>/<shortcode>/ form — dropping the
 * optional username segment and tracking params like ?igsh=. "/reels/"
 * becomes "/reel/" (same content). Idempotent (passthrough.ts relies on
 * that).
 *
 * Stories are rejected with a specific message: Instagram only serves
 * them to logged-in accounts, and XDrop never authenticates.
 *
 * Assumes `url` is already a well-formed http(s) URL on an Instagram
 * hostname — platform-detector.ts guarantees that before this is ever
 * called.
 */
export function normalizeInstagramUrl(url: string): string {
  const parsed = new URL(url);

  if (/^\/stories\//.test(parsed.pathname)) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "Instagram Stories are only visible to logged-in accounts, so XDrop can't download them."
    );
  }

  const match = parsed.pathname.match(POST_PATH_RE);
  if (!match) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "The URL does not look like an Instagram post (expected /reel/<id>, /p/<id>, or /tv/<id>)."
    );
  }

  const kind = match[1] === "reels" ? "reel" : match[1];
  const shortcode = match[2];
  return `https://www.instagram.com/${kind}/${shortcode}/`;
}

/** True for Instagram's opaque /share/... links, which need a redirect followed first. */
export function isInstagramShareLink(url: string): boolean {
  try {
    return /^\/share\/(?:(?:reel|p|tv)\/)?[A-Za-z0-9_-]+\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The shortcode from a canonical Instagram URL. */
export function instagramShortcode(canonicalUrl: string): string | undefined {
  return canonicalUrl.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)\/$/)?.[1];
}
