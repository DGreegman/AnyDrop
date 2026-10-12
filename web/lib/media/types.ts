export type Platform = "x" | "instagram" | "tiktok" | "facebook";

/**
 * How a variant is delivered, which is what the UI needs to know to
 * present it honestly:
 *   - "file": one existing audio+video file, streamed through the
 *     download proxy as-is (seekable where the CDN supports ranges).
 *   - "merged": a separate video-only and audio-only stream the server
 *     combines with ffmpeg on the fly — usually the highest quality, but
 *     slower to start and not seekable. Only offered when ffmpeg is
 *     available (see ffmpeg.ts).
 *   - "audio": the soundtrack only, as MP3.
 * Absent means "file" (older responses never had the field).
 */
export type VariantKind = "file" | "merged" | "audio";

export interface MediaVariant {
  url: string;
  quality: string;
  width?: number;
  height?: number;
  bitrate?: number;
  format: string;
  hasAudio: boolean;
  kind?: VariantKind;
}

export interface MediaAuthor {
  username?: string;
  displayName?: string;
  avatar?: string;
}

/**
 * One video inside a post. Most posts have exactly one; X tweets can carry
 * up to four videos and Instagram carousels several — yt-dlp reports each
 * as its own playlist entry, and each becomes one item here.
 */
export interface MediaItem {
  /** 1-based position in the post, matching yt-dlp's playlist_index. */
  index: number;
  title?: string;
  thumbnail?: string;
  duration?: number;
  media: MediaVariant[];
}

export interface ResolvedMedia {
  platform: Platform;
  sourceUrl: string;
  /** Stable id for the post (tweet id, shortcode, video id) when known. */
  id?: string;
  thumbnail?: string;
  title?: string;
  author?: MediaAuthor;
  duration?: number;
  /**
   * The first item's variants — kept at the top level so single-video
   * consumers (and the legacy /api/videos/resolve shape) work unchanged.
   */
  media: MediaVariant[];
  /** Every item in the post, only present when there's more than one. */
  items?: MediaItem[];
}

/**
 * The one boundary the rest of the app depends on. Each platform
 * implements this once (see x/resolver.ts for X) and registers itself in
 * resolver-registry.ts — no other file needs to change to add a platform.
 */
export interface MediaResolver {
  resolve(url: string): Promise<ResolvedMedia>;
}
