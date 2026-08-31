export type Platform = "x" | "instagram" | "tiktok" | "facebook";

export interface MediaVariant {
  url: string;
  quality: string;
  width?: number;
  height?: number;
  bitrate?: number;
  format: string;
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

/**
 * The one boundary the rest of the app depends on. Each platform
 * implements this once (see x/resolver.ts for X) and registers itself in
 * resolver-registry.ts — no other file needs to change to add a platform.
 */
export interface MediaResolver {
  resolve(url: string): Promise<ResolvedMedia>;
}
