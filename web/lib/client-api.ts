// Client-side API helper. Frontend and API share one origin (Next.js
// fullstack), so these are always relative fetches — no base URL, no CORS.

export type Platform = "x" | "instagram" | "tiktok" | "facebook";

export type VariantKind = "file" | "merged" | "audio";

export interface MediaVariant {
  quality: string;
  width?: number;
  height?: number;
  bitrate?: number;
  format: string;
  url: string;
  hasAudio: boolean;
  kind?: VariantKind;
}

export interface MediaItem {
  index: number;
  title?: string;
  thumbnail?: string;
  duration?: number;
  media: MediaVariant[];
}

export interface MediaAuthor {
  username?: string;
  displayName?: string;
  avatar?: string;
}

export interface ResolvedMedia {
  platform: Platform;
  sourceUrl: string;
  id?: string;
  thumbnail?: string;
  title?: string;
  author?: MediaAuthor;
  duration?: number;
  media: MediaVariant[];
  items?: MediaItem[];
}

export interface ApiError {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  code: string;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
  }
}

export async function resolveVideo(url: string): Promise<ResolvedMedia> {
  let res: Response;
  try {
    res = await fetch("/api/media/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    // fetch() itself threw — the API is unreachable (server down, offline,
    // etc). There's no HTTP response to read a {success, error} JSON body
    // from, so this is a distinct failure mode from every other error
    // below. Route it through the same ApiRequestError shape anyway so
    // callers only ever handle one error type.
    throw new ApiRequestError({
      code: "NETWORK_ERROR",
      message: "Could not reach the XDrop server. Please try again.",
    });
  }

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.success) {
    const error: ApiError = json?.error ?? {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    };
    throw new ApiRequestError(error);
  }

  return json.data as ResolvedMedia;
}

export function downloadUrl(mediaUrl: string, quality: string, name?: string): string {
  const params = new URLSearchParams({ url: mediaUrl, quality });
  if (name) params.set("name", name);
  return `/api/media/download?${params.toString()}`;
}

export interface DownloadProgress {
  received: number;
  /** Total bytes, when the server knows it (not for merged/MP3/TikTok streams). */
  total?: number;
}

/**
 * Downloads through the API with progress reporting, then hands the file
 * to the browser's save flow. Doing it via fetch (rather than a plain
 * link) is what makes two things possible:
 *   - a progress indicator — merged/MP3 downloads can take several
 *     seconds before the first byte while the server prepares them, and a
 *     plain link shows nothing at all during that time;
 *   - a readable error message — a plain link to a failing download
 *     would save the JSON error body as a broken ".mp4".
 * The trade-off is that the file is held in memory until it completes,
 * which is fine for social-media-length videos.
 */
export async function downloadWithProgress(
  href: string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(href, { signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiRequestError({
      code: "NETWORK_ERROR",
      message: "Could not reach the XDrop server. Please try again.",
    });
  }

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiRequestError(
      json?.error ?? { code: "DOWNLOAD_FAILED", message: "The download failed. Please try again." }
    );
  }

  const totalHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
  const chunks: BlobPart[] = [];
  let received = 0;

  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress({ received, total });
    }
  } else {
    const buf = await res.arrayBuffer();
    chunks.push(buf);
    received = buf.byteLength;
  }

  const type = res.headers.get("content-type") ?? "application/octet-stream";
  const filename =
    res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "xdrop-video.mp4";

  const blobUrl = URL.createObjectURL(new Blob(chunks, { type }));
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the save before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/**
 * Some platforms' CDNs reject a browser loading their media directly from
 * a third-party page (referrer/hotlink checks — X requires one, verified;
 * TikTok requires a whole solved bot-challenge cookie a plain <video> tag
 * can never provide), so playback goes through the same backend streaming
 * proxy as downloads, just with an inline Content-Disposition so it plays
 * instead of saving.
 */
export function streamUrl(mediaUrl: string, quality: string): string {
  const params = new URLSearchParams({ url: mediaUrl, quality, mode: "inline" });
  return `/api/media/download?${params.toString()}`;
}
