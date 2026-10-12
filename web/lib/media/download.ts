import { config } from "./config";
import { AppError } from "./errors";
import { buildPassthroughResponse, isPassthroughUrl, parsePassthroughUrl } from "./passthrough";

/**
 * Hosts XDrop is willing to fetch media from and stream back to the
 * browser, and the Referer each expects — this is the whole SSRF defense
 * for the download endpoint, not a general-purpose URL proxy. Each entry
 * was verified against real resolver output before being added, not
 * guessed:
 *   - twimg.com: X's media CDN (video.twimg.com, pbs.twimg.com, ...).
 *   - fbcdn.net: Meta's media CDN, used by both Instagram
 *     (instagram.fbni1-1.fna.fbcdn.net) and Facebook
 *     (video.fbni1-2.fna.fbcdn.net, scontent.*.fbcdn.net) — confirmed via
 *     real resolutions on both. Neither enforces a Referer (verified: the
 *     same signed URL returns 206 with no referer, a facebook.com one,
 *     or an instagram.com one), so one shared entry serves both.
 *   - tiktokcdn.com: TikTok's *thumbnail* CDN (p16-common-sign.tiktokcdn.com)
 *     — re-verified fetchable without cookies. TikTok *video* never comes
 *     through here; it always goes through passthrough.ts instead.
 * Adding a platform means adding its CDN host(s) + referer here too, once
 * that platform has a resolver and its real media URLs have been checked.
 */
const ALLOWED_MEDIA_HOSTS: ReadonlyArray<{ suffix: string; referer: string }> = [
  { suffix: "twimg.com", referer: "https://x.com/" },
  { suffix: "fbcdn.net", referer: "https://www.facebook.com/" },
  { suffix: "tiktokcdn.com", referer: "https://www.tiktok.com/" },
];

function findAllowedHost(hostname: string): { suffix: string; referer: string } | undefined {
  const h = hostname.toLowerCase();
  return ALLOWED_MEDIA_HOSTS.find((entry) => h === entry.suffix || h.endsWith(`.${entry.suffix}`));
}

function isAllowedMediaHost(hostname: string): boolean {
  return findAllowedHost(hostname) !== undefined;
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

  // Not a direct CDN file URL but a validated post URL + format selector
  // that gets re-resolved through yt-dlp (TikTok, merged qualities, MP3 —
  // see passthrough.ts). Checked narrowly: only the exact canonical shape
  // XDrop's own resolvers generate, never "any tiktok.com URL".
  if (isPassthroughUrl(url)) {
    return url;
  }

  if (!isAllowedMediaHost(url.hostname)) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "This media host is not supported for download."
    );
  }

  return url;
}

/**
 * Builds the download's filename from the client-suggested base name
 * (e.g. "tiktok-natgeo-7595589117723954487-720p") and the quality label,
 * reduced to a conservative charset — it ends up inside a quoted
 * Content-Disposition header, so nothing that could break out of the
 * quotes or carry a path ever gets through.
 */
export function safeFilename(quality?: string, name?: string, ext: "mp4" | "mp3" = "mp4"): string {
  const clean = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
  const base = name ? clean(name).slice(0, 120) : "";
  if (base) return `${base}.${ext}`;
  const q = clean(quality ?? "video");
  return `xdrop-${q || "video"}.${ext}`;
}

export type StreamDisposition = "attachment" | "inline";

/**
 * Fetches the (already-validated) media URL and returns a Response whose
 * body is the upstream's own ReadableStream, piped straight through — the
 * media is never buffered fully in memory. Manually follows a small
 * number of redirects, re-validating the host allowlist on every hop,
 * instead of letting fetch follow a redirect to an arbitrary host.
 *
 * X's CDN enforces referrer/hotlink checks that reject a browser loading
 * video.twimg.com directly from a third-party page, so both playback
 * (`inline`) and saving (`attachment`) go through this proxy — see
 * architecture doc §7, Strategy B. Range requests are forwarded so the
 * <video> element can seek.
 *
 * The `Referer` sent upstream is picked per-host from ALLOWED_MEDIA_HOSTS
 * above (X's CDN requires one matching x.com; Instagram's CDN didn't
 * enforce one in testing, but a matching instagram.com referer is sent
 * anyway as the more correct/defensive default).
 */
export async function buildMediaResponse(
  mediaUrl: URL,
  options: { quality?: string; name?: string; disposition: StreamDisposition; range?: string | null }
): Promise<Response> {
  const passthrough = parsePassthroughUrl(mediaUrl);
  if (passthrough) {
    return buildPassthroughResponse(passthrough, {
      disposition: options.disposition,
      filename: safeFilename(options.quality, options.name, passthrough.audio ? "mp3" : "mp4"),
    });
  }

  let target = mediaUrl;
  let upstream: globalThis.Response | undefined;

  for (let hop = 0; hop < 5; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.downloadTimeoutMs);

    // Safe fallback only — validateMediaUrl() already guarantees `target`
    // matches an allowlisted host before this ever runs.
    const referer = findAllowedHost(target.hostname)?.referer ?? "https://x.com/";
    const headers: Record<string, string> = {
      "User-Agent": "XDrop/1.0",
      Referer: referer,
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
      ? `attachment; filename="${safeFilename(options.quality, options.name)}"`
      : "inline"
  );

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
