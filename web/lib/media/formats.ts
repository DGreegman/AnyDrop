import { hasFfmpeg } from "./ffmpeg";
import { MediaVariant } from "./types";

/**
 * The subset of a yt-dlp format object the resolvers read. yt-dlp's raw
 * JSON is far larger — only these fields are typed so resolver-internal
 * structure never leaks past lib/media.
 */
export interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  protocol?: string;
  width?: number | null;
  height?: number | null;
  tbr?: number | null; // total bitrate, kbps
  url?: string;
}

// Query params XDrop appends to a validated post URL to describe a
// download that has to go back through yt-dlp rather than a plain CDN
// fetch — see passthrough.ts, which is the only thing that reads them.
export const XDROP_FORMAT_PARAM = "xdrop_format";
export const XDROP_ITEM_PARAM = "xdrop_item";
export const XDROP_AUDIO_PARAM = "xdrop_audio";

/**
 * "mp3": convert whatever the source audio is to MP3 with ffmpeg.
 * "copy": the selected format already *is* an MP3 (TikTok's soundtrack)
 * — stream it as-is; no ffmpeg involved.
 */
export type AudioMode = "mp3" | "copy";

/**
 * Builds a passthrough reference: the post's own (already validated,
 * canonical) URL plus the exact yt-dlp format selector to fetch, and
 * optionally which item of a multi-video post and whether to convert to
 * MP3. This — not a raw CDN URL — is what goes in `MediaVariant.url` for
 * anything the download endpoint must produce by re-invoking yt-dlp.
 */
export function buildPassthroughUrl(
  pageUrl: string,
  formatSpec: string,
  options: { item?: number; audio?: AudioMode } = {}
): string {
  const url = new URL(pageUrl);
  url.searchParams.set(XDROP_FORMAT_PARAM, formatSpec);
  if (options.item !== undefined) url.searchParams.set(XDROP_ITEM_PARAM, String(options.item));
  if (options.audio) url.searchParams.set(XDROP_AUDIO_PARAM, options.audio);
  return url.toString();
}

function isVideoOnly(f: YtDlpFormat): boolean {
  return Boolean(f.url && f.format_id && f.height && f.vcodec && f.vcodec !== "none" && f.acodec === "none");
}

// acodec may be null rather than a codec name — X's HLS audio stream
// ("hls-audio-128000-Audio") is reported with vcodec "none" and acodec
// null, verified against a real tweet. Only an explicit "none" means
// "no audio"; storyboards (mhtml) are excluded separately.
function isAudioOnly(f: YtDlpFormat): boolean {
  return Boolean(
    f.url && f.format_id && f.vcodec === "none" && f.acodec !== "none" && f.ext !== "mhtml"
  );
}

function isH264(f: YtDlpFormat): boolean {
  return /^(avc1|h264)/i.test(f.vcodec ?? "");
}

/**
 * Highest-resolution video-only stream. At equal height, H.264 wins over
 * VP9/HEVC — it plays everywhere (older iPhones' Photos app included),
 * where VP9-in-MP4 doesn't — then the higher bitrate.
 */
export function bestVideoOnly(formats: YtDlpFormat[]): YtDlpFormat | undefined {
  return formats
    .filter(isVideoOnly)
    .sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        Number(isH264(b)) - Number(isH264(a)) ||
        (b.tbr ?? 0) - (a.tbr ?? 0)
    )[0];
}

/** Highest-bitrate audio-only stream, preferring AAC/M4A at a tie. */
export function bestAudioOnly(formats: YtDlpFormat[]): YtDlpFormat | undefined {
  const isAac = (f: YtDlpFormat) => /^mp4a|aac/i.test(f.acodec ?? "");
  return formats
    .filter(isAudioOnly)
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0) || Number(isAac(b)) - Number(isAac(a)))[0];
}

/**
 * The variants that exist only because yt-dlp (and usually ffmpeg) can
 * produce them on demand, appended after a resolver's plain file
 * variants:
 *
 *   - A "merged" variant — best video-only stream + best audio-only
 *     stream, combined on the fly — but only when it's actually better
 *     than every plain file already on offer (`fileMaxHeight`; unknown
 *     heights count as 0, since e.g. Instagram's single progressive file
 *     carries no dimensions at all). Needs ffmpeg.
 *   - An "audio" (MP3) variant. Needs ffmpeg to convert, unless the
 *     platform already serves an MP3 (TikTok does).
 *
 * `fallbackAudioFormatId` is used for the MP3 when there's no audio-only
 * stream to take it from (e.g. X's progressive files carry audio inline
 * but X lists no separate audio stream for every video).
 */
export function onDemandVariants(
  pageUrl: string,
  formats: YtDlpFormat[],
  options: {
    item?: number;
    fileMaxHeight: number;
    fallbackAudioFormatId?: string;
    canMerge?: boolean;
  }
): MediaVariant[] {
  const canMerge = options.canMerge ?? hasFfmpeg();
  const variants: MediaVariant[] = [];

  const video = bestVideoOnly(formats);
  const audio = bestAudioOnly(formats);

  if (canMerge && video && audio && (video.height ?? 0) > options.fileMaxHeight) {
    variants.push({
      url: buildPassthroughUrl(pageUrl, `${video.format_id}+${audio.format_id}`, { item: options.item }),
      quality: `${video.height}p`,
      width: video.width ?? undefined,
      height: video.height ?? undefined,
      bitrate: Math.round(((video.tbr ?? 0) + (audio.tbr ?? 0)) * 1000) || undefined,
      format: "mp4",
      hasAudio: true,
      kind: "merged",
    });
  }

  if (audio?.ext === "mp3") {
    // Already MP3 upstream — no conversion, no ffmpeg needed.
    variants.push(
      audioVariant(
        buildPassthroughUrl(pageUrl, audio.format_id as string, { item: options.item, audio: "copy" }),
        audio
      )
    );
  } else if (canMerge) {
    const sourceId = audio?.format_id ?? options.fallbackAudioFormatId;
    if (sourceId) {
      variants.push(
        audioVariant(buildPassthroughUrl(pageUrl, sourceId, { item: options.item, audio: "mp3" }), audio)
      );
    }
  }

  return variants;
}

function audioVariant(url: string, source: YtDlpFormat | undefined): MediaVariant {
  return {
    url,
    quality: "Audio",
    bitrate: source?.tbr ? Math.round(source.tbr * 1000) : undefined,
    format: "mp3",
    hasAudio: true,
    kind: "audio",
  };
}

/** Max known height across already-built plain file variants (0 if none known). */
export function maxHeight(variants: MediaVariant[]): number {
  return variants.reduce((max, v) => Math.max(max, v.height ?? 0), 0);
}
