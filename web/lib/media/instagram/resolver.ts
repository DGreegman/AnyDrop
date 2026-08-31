import { runYtDlp } from "../yt-dlp";
import { normalizeInstagramUrl } from "./validator";
import { AppError } from "../errors";
import { MediaAuthor, MediaResolver, MediaVariant, ResolvedMedia } from "../types";

/**
 * yt-dlp's raw JSON is far larger than this — we only type the fields we
 * actually read, so we never leak resolver-internal structure past this file.
 */
export interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  protocol?: string;
  width?: number;
  height?: number;
  tbr?: number; // total bitrate, kbps
  url?: string;
}

export interface YtDlpOutput {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  extractor?: string;
  channel?: string; // the actual @username, e.g. "natgeo"
  uploader?: string; // display name, e.g. "National Geographic" — can be messy/absent
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
  // login" for Instagram — both produce this same message. Since XDrop
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
 * Normalizes yt-dlp's raw --dump-json output for an Instagram Reel into
 * XDrop's generic ResolvedMedia shape.
 *
 * Instagram's format list looks nothing like X's: there is no single
 * progressive format carrying real width/height/bitrate. Instead, per a
 * real Reel's --dump-json (verified empirically, not assumed):
 *   - A small number of *duplicate* entries (format_id "1", "2", "3", ...)
 *     all pointing at the exact same URL — the actual muxed (video+audio)
 *     progressive file, but with no dimension/bitrate metadata attached.
 *   - Several DASH video-only streams (acodec explicitly "none") that DO
 *     carry real width/height/bitrate, plus one DASH audio-only stream.
 * XDrop only ever serves single-file, directly-fetchable media (no
 * server-side muxing, no client-side DASH/HLS stitching — the same
 * constraint X's resolver already operates under), so only the
 * progressive, audio-carrying format is used. The DASH-only streams exist
 * solely to prove there's a real video track upstream; their per-quality
 * dimensions aren't attributed to the progressive file since that would
 * be guessing which one it actually matches.
 */
export function normalizeYtDlpOutput(sourceUrl: string, raw: YtDlpOutput): ResolvedMedia {
  const formats = raw.formats ?? [];

  const progressiveUrls = new Set<string>();
  const media: MediaVariant[] = [];

  for (const f of formats) {
    if (!f.url || f.vcodec === "none" || f.acodec === "none") continue; // video-only or audio-only DASH stream
    if (f.ext !== "mp4" && f.ext !== "webm") continue;
    if (progressiveUrls.has(f.url)) continue; // yt-dlp lists the same progressive file 2-3x under different format_ids
    progressiveUrls.add(f.url);

    media.push({
      url: f.url,
      // No reliable per-format quality signal for these (see doc comment
      // above) — "original" is honest about that rather than inventing a
      // resolution. Falls back to format_id in the unlikely case yt-dlp
      // ever does attach a height here for some Reel.
      quality: f.height ? `${f.height}p` : "original",
      width: f.width,
      height: f.height,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      format: f.ext ?? "mp4",
      hasAudio: f.acodec !== "none",
    });
  }

  if (media.length === 0) {
    throw new AppError("VIDEO_UNAVAILABLE", "No downloadable media variants were found.");
  }

  return {
    platform: "instagram",
    sourceUrl,
    thumbnail: raw.thumbnail,
    title: raw.title ?? raw.description?.slice(0, 140),
    author: extractAuthor(raw),
    // Instagram's extractor doesn't reliably populate duration for Reels
    // (verified: null across multiple real, working Reels) — omit rather
    // than report a wrong/zero value.
    duration: raw.duration ? Math.round(raw.duration) : undefined,
    media,
  };
}

export class InstagramResolver implements MediaResolver {
  async resolve(url: string): Promise<ResolvedMedia> {
    // Instagram-specific: confirms this is actually a Reel URL and
    // normalizes it to a canonical form — see instagram/validator.ts.
    // Everything upstream (platform-detector.ts) only checked the hostname.
    const normalizedUrl = normalizeInstagramUrl(url);

    const { stdout, stderr, code } = await runYtDlp(normalizedUrl);

    if (code !== 0 || !stdout.trim()) {
      throw classifyResolverFailure(stderr);
    }

    let raw: YtDlpOutput;
    try {
      raw = JSON.parse(stdout.trim().split("\n")[0]);
    } catch (err) {
      throw new AppError(
        "VIDEO_RESOLUTION_FAILED",
        "Unable to parse the resolver response.",
        { cause: err }
      );
    }

    // Mirrors X's same defensive check: only trust output that actually
    // came from Instagram's own extractor, not an embedded link yt-dlp
    // followed to a different site.
    if (raw.extractor && raw.extractor.toLowerCase() !== "instagram") {
      throw new AppError(
        "VIDEO_NOT_FOUND",
        "This post does not contain a video hosted on Instagram."
      );
    }

    return normalizeYtDlpOutput(normalizedUrl, raw);
  }
}
