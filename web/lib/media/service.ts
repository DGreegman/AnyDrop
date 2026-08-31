import { AppError } from "./errors";
import { MediaResolver, Platform, ResolvedMedia } from "./types";
import { detectPlatform } from "./platform-detector";
import { getResolver } from "./resolver-registry";

/**
 * Top-level orchestration: detect which platform a URL belongs to, hand
 * off to that platform's resolver, and return the normalized result.
 * Deliberately knows nothing about yt-dlp, subprocess handling, or any
 * platform-specific extraction detail — that all lives behind the
 * MediaResolver interface each platform implements.
 *
 * `resolveForPlatform` defaults to the real resolver-registry lookup;
 * tests can inject a fake to exercise the orchestration flow without a
 * real resolver (yt-dlp, network, etc) in the loop.
 */
export class MediaService {
  constructor(private readonly resolveForPlatform: (platform: Platform) => MediaResolver = getResolver) {}

  async resolveMedia(url: string): Promise<ResolvedMedia> {
    // detectPlatform both validates that `url` is well-formed http(s) and
    // identifies which platform it belongs to — see platform-detector.ts.
    const platform = detectPlatform(url);
    const resolver = this.resolveForPlatform(platform);

    const resolved = await resolver.resolve(url);

    if (!resolved.media || resolved.media.length === 0) {
      throw new AppError("VIDEO_UNAVAILABLE", "No downloadable media variants were found.");
    }

    return resolved;
  }
}
