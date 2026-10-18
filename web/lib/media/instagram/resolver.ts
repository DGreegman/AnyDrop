import { parseYtDlpJsonLines, runYtDlp } from "../yt-dlp";
import { instagramShortcode, isInstagramShareLink, normalizeInstagramUrl } from "./validator";
import { AppError } from "../errors";
import { MediaAuthor, MediaItem, MediaResolver, MediaVariant, ResolvedMedia } from "../types";
import { YtDlpFormat, maxHeight, onDemandVariants } from "../formats";
import { assembleResolvedMedia, pickTitle, roundDuration } from "../assemble";
import { platformForHostname } from "../platforms";

export type { YtDlpFormat };

export interface YtDlpOutput {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  extractor?: string;
  channel?: string; // the actual @username, e.g. "natgeo"
  uploader?: string; // display name, e.g. "National Geographic" — can be messy/absent
  playlist_index?: number | null;
}

/**
 * Maps a non-zero yt-dlp exit to a specific AppError based on its stderr
 * text. Instagram's extractor uses different wording from X's, so this is
 * its own function rather than sharing X's classifyResolverFailure —
 * verified against real yt-dlp output for: a nonexistent Reel, a
 * non-Reel Instagram URL, and a real Reel restricted for "certain
 * audiences" (age/sensitivity-gated content Instagram won't serve to a
 * logged-out request).
 */
export function classifyResolverFailure(stderr: string): AppError {
  const lower = stderr.toLowerCase();

  // yt-dlp can't distinguish "doesn't exist" from "exists but requires
  // login" for Instagram — both produce this same message. Since AnyDrop
  // never authenticates (see resolve() below), treat it as "not publicly
  // accessible" rather than guessing which one it actually is. Same
  // treatment for audience-restricted content (age/sensitive-content
  // gates) — also inaccessible without an authenticated, opted-in account.
  if (
    lower.includes("empty media response") ||
    lower.includes("logged-in") ||
    lower.includes("login required") ||
    lower.includes("rate-limit") ||
    lower.includes("isn't available") ||
    lower.includes("certain audiences")
  ) {
    return new AppError("VIDEO_UNAVAILABLE", "This post is not publicly accessible.");
  }
  if (lower.includes("unable to extract") || lower.includes("no video formats found")) {
    return new AppError("VIDEO_NOT_FOUND", "This post does not contain a video.");
  }
  return new AppError("VIDEO_RESOLUTION_FAILED", "Unable to resolve media from this post.", {
    cause: stderr,
  });
}

/**
 * Instagram's extractor (unlike X's) exposes a real display name/handle
 * directly — `channel` is the @username, `uploader` the display name.
 * Only included when present; never guessed.
 */
function extractAuthor(raw: YtDlpOutput): MediaAuthor | undefined {
  if (!raw.channel && !raw.uploader) return undefined;
  return {
    username: raw.channel || undefined,
    displayName: raw.uploader || undefined,
  };
}

/**
 * Normalizes one yt-dlp entry (one video of the post) into a MediaItem.
 *
 * Instagram's format list looks nothing like X's: there is no single
 * progressive format carrying real width/height/bitrate. Instead, per a
 * real Reel's --dump-json (verified empirically, not assumed):
 *   - A small number of *duplicate* entries (format_id "1", "2", "3", ...)
 *     all pointing at the exact same URL — the actual muxed (video+audio)
 *     progressive file, but with no dimension/bitrate metadata attached.
 *   - Several DASH video-only streams (acodec explicitly "none") that DO
 *     carry real width/height/bitrate, plus one DASH audio-only stream.
 * The progressive file becomes the one plain "file" variant. Its
 * dimensions aren't borrowed from a DASH stream (that would be guessing
 * which one it matches), so its quality is "original".
 *
 * The DASH streams aren't wasted any more: when ffmpeg is available,
 * onDemandVariants() adds a "merged" variant combining the best DASH
 * video (verified: 1080p on a real post whose progressive file is
 * smaller) with the DASH audio — see formats.ts.
 *
 * Progressive files Instagram marks silent (acodec explicitly "none",
 * no codec string on vcodec — seen on older carousel videos) are kept
 * with hasAudio: false rather than dropped.
 */
function normalizeItem(
  sourceUrl: string,
  raw: YtDlpOutput,
  index: number,
  multi: boolean,
  canMerge?: boolean
): MediaItem {
  const formats = raw.formats ?? [];

  const progressiveUrls = new Set<string>();
  const files: MediaVariant[] = [];

  for (const f of formats) {
    if (!f.url || f.vcodec === "none") continue; // audio-only DASH stream
    // A DASH video-only stream names its codec and says acodec "none";
    // the progressive file leaves vcodec unset.
    if (f.acodec === "none" && f.vcodec) continue;
    if (f.ext !== "mp4" && f.ext !== "webm") continue;
    if (progressiveUrls.has(f.url)) continue; // yt-dlp lists the same progressive file 2-3x under different format_ids
    progressiveUrls.add(f.url);

    files.push({
      url: f.url,
      // No reliable per-format quality signal for these (see doc comment
      // above) — "original" is honest about that rather than inventing a
      // resolution. Uses the real height in the unlikely case yt-dlp
      // ever does attach one for some post.
      quality: f.height ? `${f.height}p` : "original",
      width: f.width ?? undefined,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      format: f.ext ?? "mp4",
      hasAudio: f.acodec !== "none",
      kind: "file",
    });
  }

  const extra = files.every((v) => !v.hasAudio) && files.length > 0
    ? []
    : onDemandVariants(sourceUrl, formats, {
        item: multi ? index : undefined,
        fileMaxHeight: maxHeight(files),
        canMerge,
      });

  return {
    index,
    title: pickTitle(raw),
    thumbnail: raw.thumbnail,
    // Instagram's extractor doesn't reliably populate duration for Reels
    // (verified: null across multiple real, working Reels) — omitted
    // rather than reported as a wrong/zero value.
    duration: roundDuration(raw.duration),
    media: [
      ...extra.filter((v) => v.kind === "merged"),
      ...files,
      ...extra.filter((v) => v.kind === "audio"),
    ],
  };
}

/**
 * Normalizes yt-dlp's raw --dump-json output — one entry per video, so a
 * carousel post yields several — into AnyDrop's generic ResolvedMedia
 * shape. Exported (pure, no I/O) for tests; `canMerge` defaults to
 * whether ffmpeg is available.
 */
export function normalizeYtDlpOutput(
  sourceUrl: string,
  raw: YtDlpOutput | YtDlpOutput[],
  options: { canMerge?: boolean } = {}
): ResolvedMedia {
  const entries = Array.isArray(raw) ? raw : [raw];
  const multi = entries.length > 1;
  const items = entries.map((entry, i) =>
    normalizeItem(sourceUrl, entry, entry.playlist_index ?? i + 1, multi, options.canMerge)
  );

  return assembleResolvedMedia({
    platform: "instagram",
    sourceUrl,
    id: instagramShortcode(sourceUrl),
    author: extractAuthor(entries[0] ?? {}),
    items,
  });
}

const SHARE_LINK_MAX_HOPS = 4;

/**
 * Instagram's newer share links (instagram.com/share/<code>,
 * /share/reel/<code>) carry an opaque code instead of the post's
 * shortcode, and yt-dlp's Instagram extractor explicitly doesn't accept
 * them. This follows the redirect chain itself — staying on Instagram
 * hostnames only, never an arbitrary host — until it lands on a real
 * post URL, falling back to the page's canonical/og:url link.
 *
 * Caveat: no real, live /share/ link was available to test this against
 * while it was written (a made-up code just returns Instagram's generic
 * page), so the redirect shape is assumed from how Instagram's other
 * short links behave, not verified. If it can't find a post URL it says
 * so plainly rather than guessing.
 */
async function resolveShareLink(url: string): Promise<string> {
  let current = new URL(url);
  for (let hop = 0; hop < SHARE_LINK_MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AnyDrop/1.0)" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new AppError("VIDEO_RESOLUTION_FAILED", "Couldn't open this Instagram share link.", {
        cause: err,
      });
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      const next = new URL(location, current);
      if (platformForHostname(next.hostname) !== "instagram") break;
      try {
        return normalizeInstagramUrl(next.toString());
      } catch {
        current = next;
        continue;
      }
    }

    if (res.ok) {
      const html = (await res.text()).slice(0, 500_000);
      const canonical =
        html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
      if (canonical) {
        try {
          const parsed = new URL(canonical, current);
          if (platformForHostname(parsed.hostname) === "instagram") {
            return normalizeInstagramUrl(parsed.toString());
          }
        } catch {
          // fall through to the error below
        }
      }
    }
    break;
  }

  throw new AppError(
    "UNSUPPORTED_URL",
    "Couldn't open this Instagram share link. Use the post's “Copy link” option instead (a link with /reel/ or /p/ in it)."
  );
}

export class InstagramResolver implements MediaResolver {
  async resolve(url: string): Promise<ResolvedMedia> {
    // Instagram-specific: confirms this is a post URL (Reel, /p/, /tv/)
    // and normalizes it to a canonical form — see instagram/validator.ts.
    // /share/ links are followed to the post they point at first.
    // Everything upstream (platform-detector.ts) only checked the hostname.
    const normalizedUrl = isInstagramShareLink(url)
      ? await resolveShareLink(url)
      : normalizeInstagramUrl(url);

    // allowPlaylist: a carousel post comes back as one entry per video.
    const { stdout, stderr, code } = await runYtDlp(normalizedUrl, undefined, undefined, {
      allowPlaylist: true,
    });

    if (code !== 0 || !stdout.trim()) {
      throw classifyResolverFailure(stderr);
    }

    const entries = parseYtDlpJsonLines<YtDlpOutput>(stdout);
    if (entries.length === 0) {
      throw new AppError("VIDEO_RESOLUTION_FAILED", "Unable to parse the resolver response.", {
        cause: stdout.slice(0, 500),
      });
    }

    // Mirrors X's same defensive check: only trust output that actually
    // came from Instagram's own extractor, not an embedded link yt-dlp
    // followed to a different site.
    const ownEntries = entries.filter(
      (e) => !e.extractor || e.extractor.toLowerCase() === "instagram"
    );
    if (ownEntries.length === 0) {
      throw new AppError(
        "VIDEO_NOT_FOUND",
        "This post does not contain a video hosted on Instagram."
      );
    }

    return normalizeYtDlpOutput(normalizedUrl, ownEntries);
  }
}
