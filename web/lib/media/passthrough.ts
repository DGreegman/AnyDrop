import { Readable } from "stream";
import { spawnYtDlp, ytDlpPath, ytDlpStandalonePath } from "./yt-dlp";
import { ffmpegPath } from "./ffmpeg";
import { AppError } from "./errors";
import { config } from "./config";
import { Platform } from "./types";
import { platformForHostname } from "./platforms";
import { AudioMode, XDROP_AUDIO_PARAM, XDROP_FORMAT_PARAM, XDROP_ITEM_PARAM } from "./formats";
import { normalizeXUrl } from "./x/validator";
import { normalizeInstagramUrl } from "./instagram/validator";
import { normalizeTikTokUrl } from "./tiktok/validator";
import { classifyResolverFailure as classifyX } from "./x/resolver";
import { classifyResolverFailure as classifyInstagram } from "./instagram/resolver";
import { classifyResolverFailure as classifyTikTok } from "./tiktok/resolver";

/**
 * A "passthrough" media reference is a validated post URL plus the exact
 * yt-dlp format selector to fetch (see formats.ts#buildPassthroughUrl) —
 * used wherever a plain CDN fetch can't produce the file:
 *   - TikTok, always: its CDN 403s anything but yt-dlp's own requests
 *     (Akamai bot-management; verified — bare fetch and a real browser
 *     both 403 even with the right Referer/UA).
 *   - "merged" variants on any platform: separate video-only + audio-only
 *     streams that yt-dlp combines via ffmpeg.
 *   - MP3 audio variants.
 */

// Real format_ids look like "bytevc1_720p_650528-1", "hls-audio-128000-Audio",
// "dash-670913965512136v", "hd" — always starting with a letter/digit.
// Requiring that (not just an allowed charset) means a part can never be
// mistaken for a yt-dlp CLI flag when passed as the `-f` value, on top of
// spawn()'s argument array already making shell injection impossible.
// At most one "+" (video+audio) — never a free-form selector expression.
const FORMAT_PART = String.raw`[A-Za-z0-9][A-Za-z0-9_.-]{0,99}`;
const FORMAT_SPEC_RE = new RegExp(`^${FORMAT_PART}(?:\\+${FORMAT_PART})?$`);
const ITEM_RE = /^(?:[1-9]|1\d|20)$/; // 1..20, matching the resolvers' playlist cap
const AUDIO_MODES: ReadonlySet<string> = new Set<AudioMode>(["mp3", "copy"]);
const PASSTHROUGH_PARAMS = new Set([XDROP_FORMAT_PARAM, XDROP_ITEM_PARAM, XDROP_AUDIO_PARAM]);

// Platforms with a resolver; one without can't have produced a reference.
const NORMALIZERS: Partial<Record<Platform, (url: string) => string>> = {
  x: normalizeXUrl,
  instagram: normalizeInstagramUrl,
  tiktok: normalizeTikTokUrl,
};

const CLASSIFIERS: Partial<Record<Platform, (stderr: string) => AppError>> = {
  x: classifyX,
  instagram: classifyInstagram,
  tiktok: classifyTikTok,
};

export interface PassthroughRequest {
  platform: Platform;
  pageUrl: string;
  formatSpec: string;
  item?: number;
  audio?: AudioMode;
}

/**
 * Parses and strictly validates a passthrough reference. Returns null for
 * anything that isn't exactly the shape XDrop's own resolvers generate:
 *   - a recognized platform host,
 *   - a post URL that is *already* in that platform's canonical form
 *     (normalizing it is a no-op — so this is never "any page on
 *     tiktok.com", only a URL a resolver could have produced),
 *   - a safe format selector, and only XDrop's own extra params.
 */
export function parsePassthroughUrl(url: URL): PassthroughRequest | null {
  const platform = platformForHostname(url.hostname);
  const normalize = platform && NORMALIZERS[platform];
  if (!platform || !normalize) return null;

  const formatSpec = url.searchParams.get(XDROP_FORMAT_PARAM);
  if (!formatSpec || !FORMAT_SPEC_RE.test(formatSpec)) return null;

  const itemRaw = url.searchParams.get(XDROP_ITEM_PARAM);
  if (itemRaw !== null && !ITEM_RE.test(itemRaw)) return null;

  const audioRaw = url.searchParams.get(XDROP_AUDIO_PARAM);
  if (audioRaw !== null && !AUDIO_MODES.has(audioRaw)) return null;

  const page = new URL(url.toString());
  for (const key of PASSTHROUGH_PARAMS) page.searchParams.delete(key);
  const pageUrl = page.toString();

  let canonical: string;
  try {
    canonical = normalize(pageUrl);
  } catch {
    return null;
  }
  if (new URL(canonical).toString() !== pageUrl) return null;

  return {
    platform,
    pageUrl,
    formatSpec,
    item: itemRaw !== null ? Number(itemRaw) : undefined,
    audio: (audioRaw as AudioMode | null) ?? undefined,
  };
}

/** True when `url` is a well-formed passthrough reference (see above). */
export function isPassthroughUrl(url: URL): boolean {
  return parsePassthroughUrl(url) !== null;
}

// Fragmented MP4 — the only MP4 flavour ffmpeg can write to a pipe (a
// regular MP4 needs to seek back and rewrite its header). Without this,
// yt-dlp merges to stdout as MPEG-TS, which can't carry VP9: verified,
// Instagram's 1080p VP9 stream came out as an unplayable data track.
const MERGE_TO_STDOUT_ARGS = ["--downloader-args", "ffmpeg_o:-f mp4 -movflags frag_keyframe+empty_moov+default_base_moof"];
// Forces the ffmpeg downloader so the conversion happens in-stream
// (yt-dlp's -x post-processing needs a real file on disk). Verified on a
// real tweet's HLS audio.
const MP3_TO_STDOUT_ARGS = ["--downloader", "ffmpeg", "--downloader-args", "ffmpeg_o:-vn -c:a libmp3lame -q:a 2 -f mp3"];

function buildArgs(req: PassthroughRequest): string[] {
  const args = [
    req.pageUrl,
    "-f",
    req.formatSpec,
    "-o",
    "-",
    "--no-warnings",
    "--no-progress",
    "--socket-timeout",
    "15",
  ];
  args.push(...(req.item !== undefined ? ["--playlist-items", String(req.item)] : ["--no-playlist"]));

  const needsMerge = req.formatSpec.includes("+");
  const needsMp3 = req.audio === "mp3";
  if (needsMerge || needsMp3) {
    if (!ffmpegPath) {
      throw new AppError("DOWNLOAD_FAILED", "This quality isn't available on this server.");
    }
    args.push("--ffmpeg-location", ffmpegPath);
    args.push(...(needsMp3 ? MP3_TO_STDOUT_ARGS : MERGE_TO_STDOUT_ARGS));
  }
  return args;
}

export function contentTypeFor(req: PassthroughRequest): string {
  return req.audio ? "audio/mpeg" : "video/mp4";
}

/**
 * Re-invokes yt-dlp for a passthrough reference and streams its stdout
 * (`-o -`) straight into the HTTP response — the file is never written
 * to disk or buffered fully in memory:
 *
 *   - The first chunk is awaited before responding, so a yt-dlp failure
 *     comes back as a proper JSON error, not a truncated/empty file.
 *   - Backpressure: yt-dlp's stdout is paused while the client isn't
 *     reading, so a slow connection can't make the server buffer a whole
 *     merged video in memory.
 *   - The timeout is an *inactivity* timeout: a long video that's
 *     steadily streaming is never cut off part-way (only a stall is).
 *   - If the client goes away (closed tab, cancelled download), yt-dlp
 *     and its ffmpeg are killed instead of finishing for nobody.
 *
 * No Content-Length or Range/seek support — yt-dlp doesn't expose the
 * final size before streaming begins, and a merged/converted file
 * doesn't exist anywhere to take a byte range of. Browsers still
 * download/play it fine over chunked transfer; they just can't seek
 * ahead of what's already buffered.
 */
export async function buildPassthroughResponse(
  req: PassthroughRequest,
  options: { filename: string; disposition: "attachment" | "inline" }
): Promise<Response> {
  const args = buildArgs(req);
  // TikTok must use the standalone binary — see ytDlpStandalonePath's doc
  // comment in yt-dlp.ts.
  const binary = req.platform === "tiktok" ? ytDlpStandalonePath : ytDlpPath;
  const { child, timedOut, resetTimer, kill } = spawnYtDlp(args, config.downloadTimeoutMs, binary);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    // Bounded: ffmpeg's progress lines would otherwise grow this forever
    // over a long download. Only the tail matters for classifying errors.
    stderr = (stderr + chunk).slice(-20_000);
  });

  const body = new Readable({
    read() {
      child.stdout.resume();
    },
    destroy(err, callback) {
      // Client disconnected (or the stream errored) — stop yt-dlp *and*
      // its ffmpeg child (kill() signals the whole process group), and
      // close our end of the pipe so nothing stays blocked writing to it.
      if (child.exitCode === null) {
        kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) kill("SIGKILL");
        }, 3000).unref();
      }
      child.stdout.destroy();
      callback(err);
    },
  });

  // A single persistent listener does double duty: resolve the
  // "did this actually start working" promise on the first chunk, and
  // keep pushing every chunk (including that first one) into the body
  // stream — no gap where a chunk could arrive with nothing listening.
  let settled = false;
  let resolveFirstChunk!: () => void;
  let rejectFirstChunk!: (err: unknown) => void;
  const firstChunkReceived = new Promise<void>((resolve, reject) => {
    resolveFirstChunk = resolve;
    rejectFirstChunk = reject;
  });

  child.stdout.on("data", (chunk: Buffer) => {
    resetTimer();
    if (!settled) {
      settled = true;
      resolveFirstChunk();
    }
    if (!body.push(chunk)) child.stdout.pause();
  });
  child.stdout.on("end", () => body.push(null));
  child.stdout.on("error", (err) => {
    body.destroy(err);
    if (!settled) {
      settled = true;
      rejectFirstChunk(new AppError("DOWNLOAD_FAILED", "Unable to reach the media host.", { cause: err }));
    }
  });
  child.once("error", (err) => {
    if (!settled) {
      settled = true;
      rejectFirstChunk(new AppError("DOWNLOAD_FAILED", "Unable to reach the media host.", { cause: err }));
    }
  });
  child.once("close", () => {
    if (!settled) {
      settled = true;
      if (timedOut()) {
        rejectFirstChunk(new AppError("RESOLVER_TIMEOUT", "Timed out while downloading the video."));
      } else {
        const classify = CLASSIFIERS[req.platform];
        rejectFirstChunk(
          classify
            ? classify(stderr)
            : new AppError("DOWNLOAD_FAILED", "The media could not be downloaded.", { cause: stderr })
        );
      }
    } else if (timedOut()) {
      // Stalled mid-stream: end the response as an error rather than
      // letting the client believe a truncated file is complete.
      body.destroy(new Error("download stalled"));
    }
  });

  await firstChunkReceived;

  const headers = new Headers();
  headers.set("Content-Type", contentTypeFor(req));
  headers.set("Cache-Control", "no-store");
  headers.set(
    "Content-Disposition",
    options.disposition === "attachment" ? `attachment; filename="${options.filename}"` : "inline"
  );

  return new Response(Readable.toWeb(body) as unknown as ReadableStream, {
    status: 200,
    headers,
  });
}
