import { AppError } from "../errors";

// Instagram Reel URLs come in two shapes:
//   /reel/<shortcode>/
//   /<username>/reel/<shortcode>/   (username segment optional)
// Shortcodes are URL-safe base64-alphabet strings, length varies in practice.
const REEL_PATH_RE = /^\/(?:[A-Za-z0-9_.]+\/)?reel\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Instagram-specific: confirms the URL is actually a Reel URL (not e.g. a
 * bare profile page) and normalizes it to a canonical
 * https://www.instagram.com/reel/<shortcode>/ form, dropping the optional
 * username segment — yt-dlp resolves the same content either way, so
 * there's no reason to keep multiple equivalent forms floating around.
 *
 * Assumes `url` is already a well-formed http(s) URL on an Instagram
 * hostname — platform-detector.ts guarantees that before this is ever
 * called. Scoped to Reels only, matching XDrop's current Instagram
 * support — regular posts (/p/...) and IGTV (/tv/...) aren't handled.
 */
export function normalizeInstagramUrl(url: string): string {
  const parsed = new URL(url);
  const match = parsed.pathname.match(REEL_PATH_RE);
  if (!match) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "The URL does not look like an Instagram Reel (expected /reel/<id> or /<user>/reel/<id>)."
    );
  }

  const shortcode = match[1];
  return `https://www.instagram.com/reel/${shortcode}/`;
}
