import { spawn } from "child_process";
import { config } from "./config";
import { AppError } from "./errors";
import { ResolvedVideo, VideoResolver, VideoVariant } from "./types";

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
}

function runYtDlp(url: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // Argument array only — never build a shell string from user input.
    const args = [
      url,
      "--dump-json",
      "--no-warnings",
      "--no-playlist",
      "--no-progress",
      "--socket-timeout",
      "15",
    ];

    const child = spawn(config.ytDlpPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;

      // SIGTERM first, not SIGKILL: the standalone (PyInstaller) yt-dlp
      // binary self-extracts to a ~80MB temp directory on start and only
      // cleans it up on a normal exit. SIGKILL skips that entirely and
      // leaks the extraction dir on every single timeout — under any real
      // disk/memory pressure that compounds into every subsequent
      // extraction getting slower, causing more timeouts. Escalate to
      // SIGKILL only if it doesn't exit on its own shortly.
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("close", () => clearTimeout(forceKill));

      reject(new AppError("RESOLVER_TIMEOUT", "Timed out while resolving the video."));
    }, config.resolverTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new AppError("VIDEO_RESOLUTION_FAILED", "The video resolver is unavailable.", {
          cause: err,
        })
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
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
    lower.includes("private")
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
 * Normalizes yt-dlp's raw --dump-json output into XDrop's ResolvedVideo
 * shape. Exported (pure, no I/O) so resolver-response normalization is
 * covered by tests without shelling out to the real yt-dlp binary.
 */
export function normalizeYtDlpOutput(sourceUrl: string, raw: YtDlpOutput): ResolvedVideo {
  const formats = raw.formats ?? [];

  // Only progressive (single-file, directly-fetchable) mp4 variants with an
  // actual video track — this is what a <video> tag / plain download link
  // can use without an HLS player or client-side muxing.
  //
  // Note: yt-dlp's twitter extractor often leaves `vcodec` as null/undefined
  // (rather than the explicit string "none") on these progressive formats,
  // so we treat "has width+height and vcodec isn't explicitly 'none'" as
  // "this is a video track", not "vcodec is truthy".
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

  const videos: VideoVariant[] = Array.from(byQuality.values())
    .map((f) => ({
      quality: mapQualityLabel(f),
      width: f.width,
      height: f.height,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      format: f.ext ?? "mp4",
      url: f.url as string,
    }))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  if (videos.length === 0) {
    throw new AppError("VIDEO_UNAVAILABLE", "No downloadable video variants were found.");
  }

  return {
    sourceUrl,
    thumbnail: raw.thumbnail,
    title: raw.title ?? raw.description?.slice(0, 140),
    duration: raw.duration ? Math.round(raw.duration) : undefined,
    videos,
  };
}

export class XVideoResolver implements VideoResolver {
  async resolve(url: string): Promise<ResolvedVideo> {
    const { stdout, stderr, code } = await runYtDlp(url);

    if (code !== 0 || !stdout.trim()) {
      throw classifyResolverFailure(stderr);
    }

    let raw: YtDlpOutput;
    try {
      // yt-dlp can print one JSON object per line for playlists; we asked
      // for --no-playlist so take the first line.
      raw = JSON.parse(stdout.trim().split("\n")[0]);
    } catch (err) {
      throw new AppError(
        "VIDEO_RESOLUTION_FAILED",
        "Unable to parse the resolver response.",
        { cause: err }
      );
    }

    // yt-dlp's twitter extractor will follow an embedded link to a video
    // hosted on a *different* site (e.g. a tweet that just links a YouTube
    // video) and happily resolve that instead. XDrop only resolves video
    // actually hosted on X — reject anything else so we never normalize
    // (and later proxy-download) media from an arbitrary third-party host.
    if (raw.extractor && !raw.extractor.toLowerCase().startsWith("twitter")) {
      throw new AppError(
        "VIDEO_NOT_FOUND",
        "This post does not contain a video hosted on X."
      );
    }

    return normalizeYtDlpOutput(url, raw);
  }
}
