import { parseYtDlpJsonLines, runYtDlp } from "../yt-dlp";
import { facebookVideoId, normalizeFacebookUrl } from "./validator";
import { AppError } from "../errors";
import { MediaAuthor, MediaItem, MediaResolver, MediaVariant, ResolvedMedia } from "../types";
import { YtDlpFormat, bestAudioOnly, maxHeight, onDemandVariants } from "../formats";
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
  uploader?: string; // page/profile display name, e.g. "InfoPico"
  uploader_id?: string; // numeric profile id
  playlist_index?: number | null;
}

/**
 * Maps a non-zero yt-dlp exit to a specific AppError based on its stderr
 * text. Facebook's extractor has its own wording:
 *   - "Cannot parse data" is what logged-out requests get for videos
 *     Facebook won't show without an account (verified against two real
 *     page videos from yt-dlp's own test suite that now fail this way) —
 *     Facebook doesn't distinguish "removed" from "login required" here.
 *   - "Unsupported URL" after a redirect is what an fb.watch / share link
 *     with a dead code turns into (verified: a made-up fb.watch code
 *     redirects to the bare /watch/ page).
 */
export function classifyResolverFailure(stderr: string): AppError {
  const lower = stderr.toLowerCase();

  if (
    lower.includes("cannot parse data") ||
    lower.includes("login") ||
    lower.includes("logged-in") ||
    lower.includes("not available") ||
    lower.includes("content isn't available") ||
    lower.includes("private")
  ) {
    return new AppError("VIDEO_UNAVAILABLE", "This post is not publicly accessible.");
  }
  if (lower.includes("no video formats found") || lower.includes("no video could be found")) {
    return new AppError("VIDEO_NOT_FOUND", "This post does not contain a video.");
  }
  if (lower.includes("unsupported url")) {
    return new AppError("VIDEO_NOT_FOUND", "This Facebook link doesn't lead to a video.");
  }
  return new AppError("VIDEO_RESOLUTION_FAILED", "Unable to resolve media from this post.", {
    cause: stderr,
  });
}

/**
 * Normalizes one yt-dlp entry into a MediaItem.
 *
 * Facebook's format list, verified against real public videos:
 *   - "hd" and "sd": progressive mp4 files (video+audio when the video has
 *     sound), with no codec/dimension metadata attached — ffprobe on the
 *     real files showed 720x1280 and 224x400 for one video's hd/sd.
 *   - DASH video-only streams with real dimensions (format ids like
 *     "2101075653735394v") and, when the video has sound, one DASH
 *     audio-only stream ("…a").
 * hd/sd become plain file variants labelled "HD"/"SD" — no invented
 * resolution. Whether they carry sound isn't reported per format, so
 * it's inferred from the DASH audio stream's presence: verified both
 * ways (a video with an audio stream had AAC in hd/sd; a silent reel
 * with no audio stream had none).
 *
 * The CDN (video.*.fbcdn.net) serves these files to a plain fetch with
 * no referer or cookie checks (verified), so they go through the same
 * streaming proxy as Instagram's — same fbcdn.net allowlist entry.
 */
function normalizeItem(
  sourceUrl: string,
  raw: YtDlpOutput,
  index: number,
  multi: boolean,
  canMerge?: boolean
): MediaItem {
  const formats = raw.formats ?? [];
  const hasAudioStream = bestAudioOnly(formats) !== undefined;
  // When there are no DASH streams at all there's nothing to infer from
  // — assume sound, the overwhelmingly common case.
  const hasDash = formats.some((f) => f.vcodec && f.vcodec !== "none");
  const progressiveHasAudio = hasAudioStream || !hasDash;

  const files: MediaVariant[] = [];
  let bestFileId: string | undefined;
  for (const id of ["hd", "sd"] as const) {
    const f = formats.find((fmt) => fmt.format_id === id && fmt.url);
    if (!f) continue;
    bestFileId ??= id;
    files.push({
      url: f.url as string,
      quality: f.height ? `${f.height}p` : id.toUpperCase(),
      width: f.width ?? undefined,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      format: f.ext ?? "mp4",
      hasAudio: progressiveHasAudio,
      kind: "file",
    });
  }

  const extra = onDemandVariants(sourceUrl, formats, {
    item: multi ? index : undefined,
    fileMaxHeight: maxHeight(files),
    fallbackAudioFormatId: progressiveHasAudio ? bestFileId : undefined,
    canMerge,
  });

  return {
    index,
    title: pickTitle(raw),
    thumbnail: raw.thumbnail,
    duration: roundDuration(raw.duration),
    media: [
      ...extra.filter((v) => v.kind === "merged"),
      ...files,
      ...extra.filter((v) => v.kind === "audio"),
    ],
  };
}

/**
 * Normalizes yt-dlp's raw --dump-json output for a Facebook video (or a
 * post holding several) into XDrop's generic ResolvedMedia shape.
 * Exported (pure, no I/O) for tests; `canMerge` defaults to whether
 * ffmpeg is available.
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

  const first = entries[0] ?? {};
  // Facebook titles are often "<views> · <reactions> | <caption> | <page>";
  // the uploader field is the page name.
  const author: MediaAuthor | undefined = first.uploader
    ? { displayName: decodeEntities(first.uploader) }
    : undefined;

  return assembleResolvedMedia({
    platform: "facebook",
    sourceUrl,
    id: facebookVideoId(sourceUrl),
    author,
    items: items.map((item) => ({ ...item, title: item.title ? decodeEntities(item.title) : undefined })),
  });
}

// yt-dlp sometimes passes Facebook's HTML-escaped text through as-is
// (seen in its own test fixtures: "&#xb7;" for "·").
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export class FacebookResolver implements MediaResolver {
  async resolve(url: string): Promise<ResolvedMedia> {
    // Facebook-specific: confirms this is a video-shaped URL and
    // normalizes it — see facebook/validator.ts. Everything upstream
    // (platform-detector.ts) only checked the hostname. Share links and
    // fb.watch links pass through as-is; yt-dlp follows their redirect.
    const normalizedUrl = normalizeFacebookUrl(url);

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

    // Same defensive check as every other resolver: a Facebook post can
    // link out to e.g. YouTube, and yt-dlp would happily follow it. Only
    // keep entries Facebook's own extractor produced ("facebook",
    // "facebook:reel", …).
    const ownEntries = entries.filter(
      (e) => !e.extractor || e.extractor.toLowerCase().startsWith("facebook")
    );
    if (ownEntries.length === 0) {
      throw new AppError(
        "VIDEO_NOT_FOUND",
        "This post does not contain a video hosted on Facebook."
      );
    }

    return normalizeYtDlpOutput(normalizedUrl, ownEntries);
  }
}
