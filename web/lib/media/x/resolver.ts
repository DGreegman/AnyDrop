import { parseYtDlpJsonLines, runYtDlp } from "../yt-dlp";
import { normalizeXUrl, xStatusId } from "./validator";
import { AppError } from "../errors";
import { MediaAuthor, MediaItem, MediaResolver, MediaVariant, ResolvedMedia } from "../types";
import { YtDlpFormat, maxHeight, onDemandVariants } from "../formats";
import { assembleResolvedMedia, pickTitle, roundDuration } from "../assemble";

export type { YtDlpFormat };

/**
 * yt-dlp's raw JSON is far larger than this — we only type the fields we
 * actually read, so we never leak resolver-internal structure past this file.
 */
export interface YtDlpOutput {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  extractor?: string;
  playlist_index?: number | null;
  uploader?: string; // display name, e.g. "Prime Video UK & IE"
  uploader_id?: string; // the @handle, e.g. "primevideouk"
}

function mapQualityLabel(format: YtDlpFormat): string {
  if (format.height) return `${format.height}p`;
  if (format.format_id) return format.format_id;
  return "unknown";
}

/**
 * Maps a non-zero yt-dlp exit to a specific AppError based on its stderr
 * text. Exported (pure, no I/O) so it's covered directly by tests instead
 * of only exercised through a real yt-dlp process.
 */
export function classifyResolverFailure(stderr: string): AppError {
  const lower = stderr.toLowerCase();
  if (lower.includes("no video could be found") || lower.includes("no media found")) {
    return new AppError("VIDEO_NOT_FOUND", "This post does not contain a video.");
  }
  if (
    lower.includes("this content isn't available") ||
    lower.includes("account is temporarily unavailable") ||
    lower.includes("suspended") ||
    lower.includes("private") ||
    // Ended/deleted live broadcasts — verified wording from a real
    // broadcast tweet: "[twitter:broadcast] …: Broadcast no longer exists".
    lower.includes("no longer exists") ||
    lower.includes("no longer available")
  ) {
    return new AppError("VIDEO_UNAVAILABLE", "This post is not publicly accessible.");
  }
  if (lower.includes("unsupported url")) {
    return new AppError("UNSUPPORTED_URL", "This URL is not a supported post.");
  }
  return new AppError("VIDEO_RESOLUTION_FAILED", "Unable to resolve video from this post.", {
    cause: stderr,
  });
}

/**
 * AnyDrop only ever calls yt-dlp with a URL already normalized to
 * https://x.com/<user>/status/<id> (see normalizeXUrl) — the handle is
 * right there in the URL, so there's no need to trust/parse yt-dlp's own
 * uploader fields (which the twitter extractor doesn't always populate).
 */
function extractHandle(sourceUrl: string): string | undefined {
  const match = sourceUrl.match(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/\d+/);
  // "i" is X's placeholder for handle-less links (/i/status/<id>), not a user.
  return match && match[1] !== "i" ? match[1] : undefined;
}

// Animated GIFs on X are served as silent MP4s from /tweet_video/
// (regular videos live under /ext_tw_video/ or /amplify_video/). yt-dlp
// doesn't flag them, and leaves acodec unset on every progressive
// format, so the URL path is the one reliable signal.
function isGifUrl(url: string): boolean {
  return url.includes("/tweet_video/");
}

/**
 * Normalizes one yt-dlp entry (one video of the post) into a MediaItem.
 *
 * Plain file variants: only progressive (single-file, directly-fetchable)
 * mp4 variants with an actual video track — what a <video> tag / plain
 * download link can use without an HLS player or client-side muxing.
 *
 * Note: yt-dlp's twitter extractor often leaves `vcodec` as null/undefined
 * (rather than the explicit string "none") on these progressive formats,
 * so we treat "has width+height and vcodec isn't explicitly 'none'" as
 * "this is a video track", not "vcodec is truthy".
 *
 * On top of those, onDemandVariants() adds a merged variant when X's HLS
 * streams beat every progressive file (and is the *only* option for
 * HLS-only videos — previously a hard failure), plus MP3 audio; both need
 * ffmpeg — see formats.ts.
 */
function normalizeItem(
  sourceUrl: string,
  raw: YtDlpOutput,
  index: number,
  multi: boolean,
  canMerge?: boolean
): MediaItem {
  const formats = raw.formats ?? [];

  const progressive = formats.filter(
    (f) =>
      f.url &&
      f.width &&
      f.height &&
      f.vcodec !== "none" &&
      f.protocol !== "m3u8" &&
      f.protocol !== "m3u8_native" &&
      (f.ext === "mp4" || f.ext === "webm")
  );

  const byQuality = new Map<string, YtDlpFormat>();
  for (const f of progressive) {
    const label = mapQualityLabel(f);
    const existing = byQuality.get(label);
    // Prefer the highest-bitrate format per quality label.
    if (!existing || (f.tbr ?? 0) > (existing.tbr ?? 0)) {
      byQuality.set(label, f);
    }
  }

  const files: MediaVariant[] = Array.from(byQuality.values())
    .map((f) => ({
      url: f.url as string,
      quality: mapQualityLabel(f),
      width: f.width ?? undefined,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      format: f.ext ?? "mp4",
      // Same defensive treatment as vcodec above: yt-dlp leaves acodec
      // null/undefined on these progressive formats rather than an
      // explicit "none" — X doesn't serve silent progressive downloads
      // (GIFs aside, detected by URL), so undefined is treated as "has
      // audio", not "unknown/false".
      hasAudio: f.acodec !== "none" && !isGifUrl(f.url as string),
      kind: "file" as const,
    }))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  const isGif = files.length > 0 && files.every((v) => !v.hasAudio);
  let extra: MediaVariant[] = [];
  if (!isGif) {
    try {
      new URL(sourceUrl);
      const bestFile = Array.from(byQuality.values()).sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
      extra = onDemandVariants(sourceUrl, formats, {
        item: multi ? index : undefined,
        fileMaxHeight: maxHeight(files),
        fallbackAudioFormatId: bestFile?.format_id,
        canMerge,
      });
    } catch {
      // sourceUrl isn't a real URL (only possible from a direct caller,
      // never from resolve()) — skip on-demand variants rather than fail.
    }
  }

  const merged = extra.filter((v) => v.kind === "merged");
  const audio = extra.filter((v) => v.kind === "audio");

  return {
    index,
    title: pickTitle(raw),
    thumbnail: raw.thumbnail,
    duration: roundDuration(raw.duration),
    media: [...merged, ...files, ...audio],
  };
}

/**
 * Normalizes yt-dlp's raw --dump-json output — one entry per video in the
 * tweet (up to four) — into AnyDrop's generic ResolvedMedia shape. Exported
 * (pure, no I/O) so resolver-response normalization is covered by tests
 * without shelling out to the real yt-dlp binary. `canMerge` defaults to
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

  // The handle in the URL is authoritative; yt-dlp's uploader_id is only
  // the fallback for handle-less /i/status/<id> links.
  const handle = extractHandle(sourceUrl) ?? entries[0]?.uploader_id;
  const author: MediaAuthor | undefined = handle
    ? { username: handle, displayName: entries[0]?.uploader || undefined }
    : undefined;

  return assembleResolvedMedia({
    platform: "x",
    sourceUrl,
    id: xStatusId(sourceUrl),
    author,
    items,
  });
}

export class XVideoResolver implements MediaResolver {
  async resolve(url: string): Promise<ResolvedMedia> {
    // X-specific: confirms this is actually a status URL and normalizes
    // it to a canonical form — see x/validator.ts. Everything upstream
    // (platform-detector.ts) only checked the hostname.
    const normalizedUrl = normalizeXUrl(url);

    // allowPlaylist: a tweet can carry up to four videos, each its own
    // yt-dlp entry (one JSON line each).
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

    // yt-dlp's twitter extractor will follow an embedded link to a video
    // hosted on a *different* site (e.g. a tweet that just links a YouTube
    // video) and happily resolve that instead. AnyDrop only resolves video
    // actually hosted on X — drop anything else so we never normalize
    // (and later proxy-download) media from an arbitrary third-party host.
    const ownEntries = entries.filter(
      (e) => !e.extractor || e.extractor.toLowerCase().startsWith("twitter")
    );
    if (ownEntries.length === 0) {
      throw new AppError(
        "VIDEO_NOT_FOUND",
        "This post does not contain a video hosted on X."
      );
    }

    return normalizeYtDlpOutput(normalizedUrl, ownEntries);
  }
}
