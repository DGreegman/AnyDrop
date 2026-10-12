import { AppError } from "./errors";
import { Platform } from "./types";
import { platformForHostname } from "./platforms";

/**
 * Identifies which platform a URL belongs to from its hostname alone —
 * real URL parsing plus an exact-match allowlist (normalized to
 * lowercase, see HOST_TO_PLATFORM in platforms.ts), no network requests,
 * no path inspection. Platform-specific path/shape validation (e.g. X
 * requiring /<user>/status/<id>) is that platform's own concern, not this
 * function's — see x/validator.ts.
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

  const platform = platformForHostname(parsed.hostname);
  if (!platform) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "This URL's platform isn't recognized. XDrop supports X, Instagram, TikTok, and Facebook links."
    );
  }

  return platform;
}
