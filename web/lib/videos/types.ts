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

/**
 * The one boundary the rest of the app depends on. Swap the implementation
 * (different CLI, a hosted API, a native library) without touching the
 * route handlers, service, or frontend.
 */
export interface VideoResolver {
  resolve(url: string): Promise<ResolvedVideo>;
}
