// Client-side API helper. Frontend and API share one origin (Next.js
// fullstack), so these are always relative fetches — no base URL, no CORS.

export interface VideoVariant {
  quality: string;
  width?: number;
  height?: number;
  bitrate?: number;
  format: string;
  url: string;
}

export interface ResolvedVideo {
  sourceUrl: string;
  thumbnail?: string;
  title?: string;
  duration?: number;
  videos: VideoVariant[];
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

export async function resolveVideo(url: string): Promise<ResolvedVideo> {
  let res: Response;
  try {
    res = await fetch("/api/videos/resolve", {
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

  return json.data as ResolvedVideo;
}

export function downloadUrl(mediaUrl: string, quality: string): string {
  const params = new URLSearchParams({ url: mediaUrl, quality });
  return `/api/videos/download?${params.toString()}`;
}

/**
 * X's CDN rejects a browser loading video.twimg.com directly from a
 * third-party page (referrer/hotlink check), so playback goes through the
 * same backend streaming proxy as downloads, just with an inline
 * Content-Disposition so it plays instead of saving.
 */
export function streamUrl(mediaUrl: string, quality: string): string {
  const params = new URLSearchParams({ url: mediaUrl, quality, mode: "inline" });
  return `/api/videos/download?${params.toString()}`;
}
