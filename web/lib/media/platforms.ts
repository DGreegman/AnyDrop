import type { Platform } from "./types";

/**
 * Isomorphic (browser + server) platform knowledge: no Node APIs, no
 * AppError, no network. The browser uses this for instant "TikTok link
 * detected" feedback and for pulling a link out of pasted/shared text;
 * the server uses the exact same table (via platform-detector.ts), so the
 * two can never disagree about what counts as a supported link.
 */

/**
 * Exact hostname -> platform lookup, not string.includes() — so e.g.
 * "https://evil.com/?u=x.com" or "https://x.com.evil.example" don't
 * falsely match.
 */
export const HOST_TO_PLATFORM: Readonly<Record<string, Platform>> = {
  "x.com": "x",
  "www.x.com": "x",
  "mobile.x.com": "x",
  "twitter.com": "x",
  "www.twitter.com": "x",
  "mobile.twitter.com": "x",
  // Embed-fixer mirrors people paste in chats so links preview properly —
  // same /<user>/status/<id> paths as x.com (verified: fxtwitter.com 302s
  // straight to the matching x.com status URL), so they're normalized to
  // x.com before yt-dlp ever sees them.
  "fxtwitter.com": "x",
  "vxtwitter.com": "x",
  "fixupx.com": "x",
  "fixvx.com": "x",

  "instagram.com": "instagram",
  "www.instagram.com": "instagram",
  // Instagram's own short domain — verified to 301 to the same path on
  // www.instagram.com.
  "instagr.am": "instagram",
  "www.instagr.am": "instagram",

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
  "web.facebook.com": "facebook",
  "mbasic.facebook.com": "facebook",
  "fb.watch": "facebook",
};

export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
};

export function platformForHostname(hostname: string): Platform | undefined {
  return HOST_TO_PLATFORM[hostname.toLowerCase()];
}

/** Platform for a full URL string, or undefined if it isn't one we know. */
export function platformForUrl(url: string): Platform | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return platformForHostname(parsed.hostname);
  } catch {
    return undefined;
  }
}

// Anything that starts like a URL and runs until whitespace or a
// character that can't appear unescaped in one. Deliberately loose —
// trailing punctuation is trimmed afterwards, and the result is still
// parsed with `new URL()` before being trusted.
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`]+/gi;

// Punctuation that commonly sticks to the end of a link in prose or share
// text ("...watch this: https://x.com/a/status/1." / "(https://...)").
const TRAILING_JUNK_RE = /[)\]}>.,;:!?'"’”…]+$/;

/**
 * Pulls the link out of free-form text — e.g. a share sheet's
 * "Check out this video! https://vm.tiktok.com/ZM.../" or a URL pasted
 * with surrounding words. Returns the first link on a supported platform;
 * failing that, the first well-formed link of any kind (so the caller can
 * still say "that site isn't supported" instead of "that's not a URL");
 * failing that, null.
 *
 * A bare host without a scheme ("x.com/user/status/1") is accepted too,
 * since that's how links often look when copied out of an address bar
 * on mobile.
 */
export function extractMediaUrl(text: string): string | null {
  if (!text) return null;

  const candidates: string[] = [];
  for (const match of text.matchAll(URL_IN_TEXT_RE)) {
    candidates.push(match[0]);
  }

  if (candidates.length === 0) {
    // Scheme-less fallback: a single token that starts with a known host.
    for (const token of text.split(/\s+/)) {
      const host = token.split(/[/?#]/)[0].toLowerCase();
      if (platformForHostname(host)) candidates.push(`https://${token}`);
    }
  }

  let firstValid: string | null = null;
  for (const raw of candidates) {
    const cleaned = trimTrailingJunk(raw);
    let parsed: URL;
    try {
      parsed = new URL(cleaned);
    } catch {
      continue;
    }
    const href = parsed.toString();
    if (platformForHostname(parsed.hostname)) return href;
    firstValid ??= href;
  }

  return firstValid;
}

function trimTrailingJunk(url: string): string {
  let out = url.replace(TRAILING_JUNK_RE, "");
  // A closing paren that's genuinely part of the URL (balanced) is kept —
  // only an unbalanced one, from prose like "(see https://...)", is junk.
  // The regex above already stripped every trailing ")", so add back the
  // ones that were balanced.
  const opens = (out.match(/\(/g) ?? []).length;
  const closes = (out.match(/\)/g) ?? []).length;
  if (opens > closes && url.startsWith(out) && url[out.length] === ")") {
    out += ")";
  }
  return out;
}
