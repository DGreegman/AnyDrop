import { config } from "./config";
import { AppError } from "./errors";

/**
 * Hosts XDrop is willing to fetch media from and stream back to the
 * browser. This is the whole SSRF defense for the download endpoint: the
 * client supplies a media URL, but it can only ever point at X's own CDN.
 * This is intentionally NOT a general-purpose URL proxy.
 */
const ALLOWED_MEDIA_HOSTS_SUFFIX = ".twimg.com";
const ALLOWED_MEDIA_HOST_EXACT = "twimg.com";

function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === ALLOWED_MEDIA_HOST_EXACT || h.endsWith(ALLOWED_MEDIA_HOSTS_SUFFIX);
}

export function validateMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("INVALID_URL", "The media reference is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new AppError("INVALID_URL", "Only https media URLs are supported.");
  }

  if (!isAllowedMediaHost(url.hostname)) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "This media host is not supported for download."
    );
  }

  return url;
}

function safeFilename(quality?: string): string {
  const q = (quality ?? "video").replace(/[^a-zA-Z0-9._-]/g, "");
  return `x-video-${q || "video"}.mp4`;
}

export type StreamDisposition = "attachment" | "inline";

/**
 * Fetches the (already-validated) media URL and returns a Response whose
 * body is the upstream's own ReadableStream, piped straight through — the
 * video is never buffered fully in memory. Manually follows a small number
 * of redirects, re-validating the host allowlist on every hop, instead of
 * letting fetch follow a redirect to an arbitrary host.
 *
 * X's CDN enforces referrer/hotlink checks that reject a browser loading
 * video.twimg.com directly from a third-party page, so both playback
 * (`inline`) and saving (`attachment`) go through this proxy — see
 * architecture doc §7, Strategy B. Range requests are forwarded so the
 * <video> element can seek.
 */
export async function buildMediaResponse(
  mediaUrl: URL,
  options: { quality?: string; disposition: StreamDisposition; range?: string | null }
): Promise<Response> {
  let target = mediaUrl;
  let upstream: globalThis.Response | undefined;

  for (let hop = 0; hop < 5; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.downloadTimeoutMs);

    const headers: Record<string, string> = {
      "User-Agent": "XDrop/1.0",
      Referer: "https://x.com/",
    };
    if (options.range) headers.Range = options.range;

    let attempt: globalThis.Response;
    try {
      attempt = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new AppError("DOWNLOAD_FAILED", "Unable to reach the media host.", { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (attempt.status >= 300 && attempt.status < 400) {
      const location = attempt.headers.get("location");
      if (!location) {
        throw new AppError("DOWNLOAD_FAILED", "Media host returned an invalid redirect.");
      }
      const next = new URL(location, target);
      if (next.protocol !== "https:" || !isAllowedMediaHost(next.hostname)) {
        throw new AppError("DOWNLOAD_FAILED", "Media host redirected outside the allowed CDN.");
      }
      target = next;
      continue;
    }

    upstream = attempt;
    break;
  }

  if (!upstream) {
    throw new AppError("DOWNLOAD_FAILED", "Too many redirects while fetching media.");
  }

  if (!upstream.ok || !upstream.body) {
    throw new AppError("DOWNLOAD_FAILED", "The media could not be downloaded.");
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "video/mp4");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "no-store");

  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  headers.set(
    "Content-Disposition",
    options.disposition === "attachment"
      ? `attachment; filename="${safeFilename(options.quality)}"`
      : "inline"
  );

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
