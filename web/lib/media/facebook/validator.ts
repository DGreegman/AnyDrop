import { AppError } from "../errors";

const ID = String.raw`(\d+|pfbid[A-Za-z0-9]+)`;
const SEGMENT = String.raw`[A-Za-z0-9._-]+`;

// Path-only shapes (the id lives in the path). Each maps to the canonical
// path it's rebuilt as — all are shapes yt-dlp's Facebook extractor
// accepts directly (see its _VALID_URL), so the canonical form never
// depends on a redirect.
const PATH_SHAPES: ReadonlyArray<{ re: RegExp; build: (m: RegExpMatchArray) => string }> = [
  { re: new RegExp(String.raw`^/reel/(\d+)/?$`), build: (m) => `/reel/${m[1]}` },
  {
    // /<page>/videos/<id>/ and /<page>/videos/<slug-or-vb.id>/<id>/
    re: new RegExp(String.raw`^/(${SEGMENT})/videos/(?:${SEGMENT}/)?(\d+)/?$`),
    build: (m) => `/${m[1]}/videos/${m[2]}/`,
  },
  { re: new RegExp(String.raw`^/(${SEGMENT})/posts/${ID}/?$`), build: (m) => `/${m[1]}/posts/${m[2]}/` },
  {
    re: new RegExp(String.raw`^/groups/(${SEGMENT})/(permalink|posts)/${ID}/?$`),
    build: (m) => `/groups/${m[1]}/${m[2]}/${m[3]}/`,
  },
];

// Opaque share links (from the app's Share → Copy link). They carry no
// video id, so they're passed through for yt-dlp to follow the redirect
// itself — the same approach as TikTok's short links.
const SHARE_PATH_RE = /^\/share\/(?:[vr]\/)?[A-Za-z0-9_-]+\/?$/;
const FB_WATCH_PATH_RE = /^\/[A-Za-z0-9_-]+\/?$/;

/**
 * Facebook-specific: confirms the URL points at a video (or a post that
 * may hold one) and normalizes it to a canonical https://www.facebook.com
 * form, dropping tracking params and m./web./mbasic. host variants.
 * Idempotent (passthrough.ts relies on that).
 *
 * Accepted:
 *   /reel/<id>                       /watch/?v=<id>, /watch/live/?v=<id>
 *   /<page>/videos/<id>              /video.php?v=<id>
 *   /<page>/posts/<id|pfbid…>        /story.php|permalink.php?story_fbid=…&id=…
 *   /groups/<g>/(permalink|posts)/<id>
 *   /share/v/<code>, /share/r/<code>, fb.watch/<code>   (passed through)
 *
 * Assumes `url` is already a well-formed http(s) URL on a Facebook
 * hostname — platform-detector.ts guarantees that before this is ever
 * called.
 */
export function normalizeFacebookUrl(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if (host === "fb.watch") {
    if (!FB_WATCH_PATH_RE.test(path)) {
      throw new AppError("UNSUPPORTED_URL", "This doesn't look like an fb.watch video link.");
    }
    return `https://fb.watch${path.endsWith("/") ? path : `${path}/`}`;
  }

  if (SHARE_PATH_RE.test(path)) {
    return `https://www.facebook.com${path.endsWith("/") ? path : `${path}/`}`;
  }

  // ?v=<id> shapes: watch, watch/live, video.php
  if (/^\/(?:watch(?:\/live)?\/?|video\.php|video\/video\.php)$/.test(path)) {
    const v = parsed.searchParams.get("v") ?? parsed.searchParams.get("video_id");
    if (v && /^\d+$/.test(v)) return `https://www.facebook.com/watch/?v=${v}`;
  }

  // ?story_fbid=…&id=… shapes
  if (path === "/story.php" || path === "/permalink.php") {
    const storyFbid = parsed.searchParams.get("story_fbid");
    const id = parsed.searchParams.get("id");
    if (storyFbid && /^(\d+|pfbid[A-Za-z0-9]+)$/.test(storyFbid)) {
      const canonical = new URL(`https://www.facebook.com${path}`);
      canonical.searchParams.set("story_fbid", storyFbid);
      if (id && /^\d+$/.test(id)) canonical.searchParams.set("id", id);
      return canonical.toString();
    }
  }

  for (const shape of PATH_SHAPES) {
    const m = path.match(shape.re);
    if (m) return `https://www.facebook.com${shape.build(m)}`;
  }

  throw new AppError(
    "UNSUPPORTED_URL",
    "The URL does not look like a Facebook video (expected a /reel/, /watch?v=, /videos/, or share link)."
  );
}

/** A stable id for the post when the canonical URL carries one. */
export function facebookVideoId(canonicalUrl: string): string | undefined {
  const parsed = new URL(canonicalUrl);
  return (
    parsed.searchParams.get("v") ??
    parsed.pathname.match(/\/(?:reel|videos)\/(\d+)\/?$/)?.[1] ??
    undefined
  );
}
