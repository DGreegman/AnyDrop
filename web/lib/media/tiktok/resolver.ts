import { parseYtDlpJsonLines, runYtDlp, ytDlpStandalonePath } from "../yt-dlp";
import { normalizeTikTokUrl, tiktokVideoId } from "./validator";
import { AppError } from "../errors";
import { MediaAuthor, MediaResolver, MediaVariant, ResolvedMedia } from "../types";
import { ANYDROP_FORMAT_PARAM, YtDlpFormat, buildPassthroughUrl, maxHeight, onDemandVariants } from "../formats";
import { assembleResolvedMedia, pickTitle, roundDuration } from "../assemble";

export { ANYDROP_FORMAT_PARAM };
export type { YtDlpFormat };

export interface YtDlpOutput {
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  extractor?: string;
  uploader?: string; // the actual @username, e.g. "natgeo"
  channel?: string; // display name, e.g. "National Geographic" — opposite
  // convention from Instagram's extractor, where channel is the username.
  webpage_url?: string; // the canonical URL after following any redirect
}

/**
 * Maps a non-zero yt-dlp exit to a specific AppError based on its stderr
 * text. TikTok's extractor uses different wording from X's/Instagram's,
 * so this is its own function. "unable to extract...universal data" was
 * verified against a real nonexistent video ID. The private/removed
 * patterns follow yt-dlp's well-established TikTok extractor messages but
 * weren't independently reproduced here (no private TikTok account was
 * available to test against) — same honest caveat as any pattern list
 * that can't cover every real-world case up front.
 *
 * Deliberately NOT pattern-matched here: "Unexpected response from
 * webpage request". During testing this showed up for a definitely-real,
 * definitely-public video after enough repeated requests — almost
 * certainly TikTok's anti-bot system temporarily throttling the request,
 * not the video being unavailable. Mapping it to NOT_FOUND/UNAVAILABLE
 * would be actively misleading, so it falls through to the generic
 * RESOLUTION_FAILED below instead.
 */
export function classifyResolverFailure(stderr: string): AppError {
  const lower = stderr.toLowerCase();

  if (lower.includes("unable to extract")) {
    return new AppError("VIDEO_NOT_FOUND", "This post does not contain a video.");
  }
  if (
    lower.includes("private") ||
    lower.includes("removed") ||
    lower.includes("no longer available") ||
    lower.includes("captcha")
  ) {
    return new AppError("VIDEO_UNAVAILABLE", "This post is not publicly accessible.");
  }
  return new AppError("VIDEO_RESOLUTION_FAILED", "Unable to resolve media from this post.", {
    cause: stderr,
  });
}

/**
 * Normalizes yt-dlp's raw --dump-json output for a TikTok video into
 * AnyDrop's generic ResolvedMedia shape.
 *
 * Unlike Instagram, TikTok's progressive formats DO carry real
 * width/height/bitrate (verified against several real videos) — each
 * quality tier just happens to be listed twice, once per CDN mirror host
 * (identical content, different edge server), deduped here by
 * (height, bitrate) rather than by URL since the two mirror URLs differ.
 *
 * The `url` on each returned variant is deliberately NOT the raw CDN URL
 * yt-dlp reports. That URL 403s on a bare fetch — TikTok's CDN sits
 * behind Akamai bot-management requiring a JS-challenge-derived cookie
 * that only yt-dlp's own challenge-solving can produce, verified
 * empirically (bare curl, and a full real-browser navigation, both 403
 * even with the correct Referer/UA; only succeeded when yt-dlp handled
 * the whole request itself). Instead, `url` is the *source* TikTok page
 * URL with a `anydrop_format` query param carrying the exact format_id to
 * request — lib/media/tiktok/download.ts recognizes this shape and
 * re-invokes yt-dlp at download time rather than proxying a dead link
 * (see passthrough.ts).
 *
 * TikTok also lists its soundtrack as a ready-made MP3 ("audio"), which
 * becomes an audio variant with no ffmpeg involved.
 */
export function normalizeYtDlpOutput(
  sourceUrl: string,
  raw: YtDlpOutput,
  options: { canMerge?: boolean } = {}
): ResolvedMedia {
  const formats = raw.formats ?? [];

  const progressive = formats.filter(
    (f) => f.url && f.format_id && f.vcodec !== "none" && f.acodec !== "none" && f.ext === "mp4"
  );

  const byQuality = new Map<string, YtDlpFormat>();
  for (const f of progressive) {
    const key = `${f.height ?? 0}x${f.tbr ?? 0}`;
    const existing = byQuality.get(key);
    if (!existing || (f.tbr ?? 0) > (existing.tbr ?? 0)) {
      byQuality.set(key, f);
    }
  }

  const files: MediaVariant[] = Array.from(byQuality.values())
    .map((f) => ({
      url: buildPassthroughUrl(sourceUrl, f.format_id as string),
      quality: f.height ? `${f.height}p` : (f.format_id as string),
      width: f.width ?? undefined,
      height: f.height ?? undefined,
      bitrate: f.tbr ? Math.round(f.tbr * 1000) : undefined,
      format: f.ext ?? "mp4",
      hasAudio: f.acodec !== "none",
      kind: "file" as const,
    }))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  const extra = onDemandVariants(sourceUrl, formats, {
    fileMaxHeight: maxHeight(files),
    canMerge: options.canMerge,
  });

  const author: MediaAuthor | undefined =
    raw.uploader || raw.channel
      ? { username: raw.uploader || undefined, displayName: raw.channel || undefined }
      : undefined;

  return assembleResolvedMedia({
    platform: "tiktok",
    sourceUrl,
    id: tiktokVideoId(sourceUrl),
    author,
    items: [
      {
        index: 1,
        title: pickTitle(raw),
        // TikTok's cover images (p16-common-sign.tiktokcdn.com) are
        // fetchable without the bot-challenge cookie the *video* CDN
        // needs — re-verified 2026-10: a plain fetch returns 200
        // image/jpeg with or without a Referer. (An earlier check found
        // them gated too; if that comes back, the preview just shows no
        // poster image — nothing else depends on it.)
        thumbnail: raw.thumbnail,
        duration: roundDuration(raw.duration),
        media: [
          ...extra.filter((v) => v.kind === "merged"),
          ...files,
          ...extra.filter((v) => v.kind === "audio"),
        ],
      },
    ],
  });
}

export class TikTokResolver implements MediaResolver {
  async resolve(url: string): Promise<ResolvedMedia> {
    // TikTok-specific: confirms this is actually a video URL (or a short
    // link) and normalizes it — see tiktok/validator.ts. Everything
    // upstream (platform-detector.ts) only checked the hostname.
    const normalizedUrl = normalizeTikTokUrl(url);

    // Must use the standalone binary specifically here, not the
    // auto-selected default — see ytDlpStandalonePath's doc comment.
    const { stdout, stderr, code } = await runYtDlp(
      normalizedUrl,
      undefined,
      ytDlpStandalonePath
    );

    if (code !== 0 || !stdout.trim()) {
      throw classifyResolverFailure(stderr);
    }

    const raw = parseYtDlpJsonLines<YtDlpOutput>(stdout)[0];
    if (!raw) {
      throw new AppError("VIDEO_RESOLUTION_FAILED", "Unable to parse the resolver response.", {
        cause: stdout.slice(0, 500),
      });
    }

    // Mirrors X's/Instagram's same defensive check: only trust output
    // that actually came from TikTok's own extractor.
    if (raw.extractor && raw.extractor.toLowerCase() !== "tiktok") {
      throw new AppError(
        "VIDEO_NOT_FOUND",
        "This post does not contain a video hosted on TikTok."
      );
    }

    // For a short link (vm./vt.tiktok.com), yt-dlp's own webpage_url is
    // the real https://www.tiktok.com/@user/video/id it redirected to —
    // use that as the canonical source so a later download doesn't have
    // to re-follow the same redirect on every request. Re-validated
    // through the same normalizer rather than trusted blindly.
    let canonicalUrl = normalizedUrl;
    if (raw.webpage_url) {
      try {
        canonicalUrl = normalizeTikTokUrl(raw.webpage_url);
      } catch {
        // Not a recognizable canonical shape — keep normalizedUrl.
      }
    }

    return normalizeYtDlpOutput(canonicalUrl, raw);
  }
}
