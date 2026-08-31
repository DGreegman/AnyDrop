import { Readable } from "stream";
import { spawnYtDlp, ytDlpStandalonePath } from "../yt-dlp";
import { AppError } from "../errors";
import { config } from "../config";
import { safeFilename, StreamDisposition } from "../download";
import { normalizeTikTokUrl } from "./validator";
import { classifyResolverFailure, XDROP_FORMAT_PARAM } from "./resolver";

// Real format_ids look like "bytevc1_720p_650528-1" / "h264_540p_164118-0"
// — always starting with a letter/digit. Requiring that (not just an
// allowed charset) means this can never be mistaken for a yt-dlp CLI flag
// when passed as the `-f` value, on top of spawn()'s argument array
// already making shell injection impossible.
const FORMAT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function stripFormatParam(url: URL): URL {
  const copy = new URL(url.toString());
  copy.searchParams.delete(XDROP_FORMAT_PARAM);
  return copy;
}

/**
 * True only for the exact shape TikTokResolver generates: a validated
 * TikTok video-page URL (same regex the resolver itself uses — see
 * tiktok/validator.ts) carrying a `xdrop_format` query param with a
 * safe-charset value. This is deliberately narrow — it is not "any
 * tiktok.com URL is allowed"; see buildTikTokMediaResponse for why a
 * plain CDN URL can't be proxied directly for this platform.
 */
export function isTikTokPassthroughUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host !== "tiktok.com" && host !== "www.tiktok.com") return false;

  const formatId = url.searchParams.get(XDROP_FORMAT_PARAM);
  if (!formatId || !FORMAT_ID_RE.test(formatId)) return false;

  try {
    normalizeTikTokUrl(stripFormatParam(url).toString());
    return true;
  } catch {
    return false;
  }
}

/**
 * TikTok's CDN sits behind Akamai bot-management requiring a
 * JS-challenge-derived cookie that only yt-dlp's own challenge-solving
 * logic can produce — verified empirically: a bare fetch (and a real
 * browser navigation) to the raw CDN URL both 403 even with a correct
 * Referer/User-Agent; only succeeded when yt-dlp handled the entire
 * request itself. A short-lived reuse of the captured cookie was also
 * tried and found unreliable (worked once, failed on immediate retry),
 * so this re-invokes yt-dlp fully for every download rather than trying
 * to cache/replay a token.
 *
 * yt-dlp streams the selected format straight to stdout (`-o -`), piped
 * directly into the HTTP response — the file is never buffered fully in
 * memory. The one exception is the very first chunk, held just long
 * enough to distinguish "this is really about to work" from "yt-dlp
 * failed before producing any bytes" (so a failure comes back as a
 * proper JSON error, not a truncated/empty file).
 *
 * No Content-Length or Range/seek support here, unlike the fetch()-based
 * X/Instagram path — yt-dlp doesn't expose the upstream size before
 * streaming begins, and there's no clean way to ask it for a byte range.
 * Browsers still download/play the file fine over chunked transfer; they
 * just can't seek ahead of what's already buffered.
 */
export async function buildTikTokMediaResponse(
  url: URL,
  options: { quality?: string; disposition: StreamDisposition }
): Promise<Response> {
  const formatId = url.searchParams.get(XDROP_FORMAT_PARAM);
  if (!formatId || !FORMAT_ID_RE.test(formatId)) {
    throw new AppError("INVALID_URL", "Missing or invalid format selector.");
  }

  const sourceUrl = normalizeTikTokUrl(stripFormatParam(url).toString());
  const args = [sourceUrl, "-f", formatId, "-o", "-", "--no-warnings", "--no-progress"];
  // Same requirement as the resolver — see ytDlpStandalonePath's doc
  // comment in yt-dlp.ts.
  const { child, timedOut } = spawnYtDlp(args, config.downloadTimeoutMs, ytDlpStandalonePath);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const combined = new Readable({ read() {} });

  // A single persistent listener does double duty: resolve the
  // "did this actually start working" promise on the first chunk, and
  // keep pushing every chunk (including that first one) into the
  // combined stream — no gap where a chunk could arrive with nothing
  // listening (which a separate once()-then-on() pair would risk).
  let settled = false;
  let resolveFirstChunk!: () => void;
  let rejectFirstChunk!: (err: unknown) => void;
  const firstChunkReceived = new Promise<void>((resolve, reject) => {
    resolveFirstChunk = resolve;
    rejectFirstChunk = reject;
  });

  child.stdout.on("data", (chunk: Buffer) => {
    if (!settled) {
      settled = true;
      resolveFirstChunk();
    }
    combined.push(chunk);
  });
  child.stdout.on("end", () => combined.push(null));
  child.stdout.on("error", (err) => {
    combined.destroy(err);
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
        rejectFirstChunk(classifyResolverFailure(stderr));
      }
    }
  });

  await firstChunkReceived;

  const headers = new Headers();
  headers.set("Content-Type", "video/mp4");
  headers.set("Cache-Control", "no-store");
  headers.set(
    "Content-Disposition",
    options.disposition === "attachment"
      ? `attachment; filename="${safeFilename(options.quality)}"`
      : "inline"
  );

  return new Response(Readable.toWeb(combined) as unknown as ReadableStream, {
    status: 200,
    headers,
  });
}
