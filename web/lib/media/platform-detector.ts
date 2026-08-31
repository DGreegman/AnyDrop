import { AppError } from "./errors";
import { Platform } from "./types";

/**
 * Exact hostname -> platform lookup, not string.includes() — so e.g.
 * "https://evil.com/?u=x.com" or "https://x.com.evil.example" don't
 * falsely match. Add a platform's hostname variants here as they're
 * implemented; the entries below for instagram/tiktok/facebook already
 * make detection work ahead of those resolvers existing (see
 * resolver-registry.ts).
 */
const HOST_TO_PLATFORM: Record<string, Platform> = {
  "x.com": "x",
  "www.x.com": "x",
  "mobile.x.com": "x",
  "twitter.com": "x",
  "www.twitter.com": "x",
  "mobile.twitter.com": "x",

  "instagram.com": "instagram",
  "www.instagram.com": "instagram",

  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "m.tiktok.com": "tiktok",
  // Share-link short domains — verified against two real, live short
  // links (both redirected correctly and yt-dlp resolved the real video
  // from each). vm. is used in Europe/Americas, vt. in parts of Asia.
  "vm.tiktok.com": "tiktok",
  "vt.tiktok.com": "tiktok",

  "facebook.com": "facebook",
  "www.facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "fb.watch": "facebook",
};

/**
 * Identifies which platform a URL belongs to from its hostname alone —
 * real URL parsing plus an exact-match allowlist (normalized to
 * lowercase), no network requests, no path inspection. Platform-specific
 * path/shape validation (e.g. X requiring /<user>/status/<id>) is that
 * platform's own concern, not this function's — see x/validator.ts.
 */
export function detectPlatform(url: string): Platform {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("INVALID_URL", "The provided value is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppError("INVALID_URL", "Only http(s) URLs are supported.");
  }

  const platform = HOST_TO_PLATFORM[parsed.hostname.toLowerCase()];
  if (!platform) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "This URL's platform isn't recognized. XDrop supports X, Instagram, TikTok, and Facebook links."
    );
  }

  return platform;
}
