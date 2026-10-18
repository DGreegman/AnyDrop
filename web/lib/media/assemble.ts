import { AppError } from "./errors";
import { MediaAuthor, MediaItem, Platform, ResolvedMedia } from "./types";

/**
 * Shared final step for every resolver: drop items that ended up with no
 * video variant (an MP3 on its own doesn't make a post "downloadable
 * video" — e.g. TikTok always lists its soundtrack, even when every
 * video format is unusable), then fold the rest into ResolvedMedia — top-level fields
 * mirror the first item (so single-video consumers and the legacy
 * /api/videos shape keep working unchanged), and `items` is only
 * attached when the post really has more than one.
 */
export function assembleResolvedMedia(input: {
  platform: Platform;
  sourceUrl: string;
  id?: string;
  title?: string;
  author?: MediaAuthor;
  items: MediaItem[];
}): ResolvedMedia {
  const items = input.items.filter((item) => item.media.some((v) => v.kind !== "audio"));
  if (items.length === 0) {
    throw new AppError("VIDEO_UNAVAILABLE", "No downloadable media variants were found.");
  }

  const first = items[0];
  const resolved: ResolvedMedia = {
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    thumbnail: first.thumbnail,
    title: input.title ?? first.title,
    author: input.author,
    duration: first.duration,
    media: first.media,
  };
  if (input.id) resolved.id = input.id;
  if (items.length > 1) resolved.items = items;
  return resolved;
}

/** Rounds a yt-dlp duration (float seconds) or drops a missing/zero one. */
export function roundDuration(duration?: number | null): number | undefined {
  return duration ? Math.round(duration) : undefined;
}

/** First 140 chars of the title, falling back to the description. */
export function pickTitle(raw: { title?: string | null; description?: string | null }): string | undefined {
  return raw.title ?? raw.description?.slice(0, 140) ?? undefined;
}
