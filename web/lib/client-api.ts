// Client-side API helper. Frontend and API share one origin (Next.js
// fullstack), so these are always relative fetches — no base URL, no CORS.

export type Platform = "x" | "instagram" | "tiktok" | "facebook";

export interface MediaVariant {
  quality: string;
  width?: number;
  height?: number;
  bitrate?: number;
  format: string;
  url: string;
  hasAudio: boolean;
}

export interface MediaAuthor {
  username?: string;
  displayName?: string;
  avatar?: string;
}

export interface ResolvedMedia {
  platform: Platform;
  sourceUrl: string;
  thumbnail?: string;
  title?: string;
  author?: MediaAuthor;
  duration?: number;
  media: MediaVariant[];
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

export function downloadUrl(mediaUrl: string, quality: string): string {
  const params = new URLSearchParams({ url: mediaUrl, quality });
  return `/api/media/download?${params.toString()}`;
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
