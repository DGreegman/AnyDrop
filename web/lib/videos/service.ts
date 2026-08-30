import { AppError } from "./errors";
import { ResolvedVideo, VideoResolver } from "./types";

/**
 * Application-level orchestration. Depends only on the VideoResolver
 * interface — swapping XVideoResolver for a different implementation
 * requires no change here.
 */
export class VideoService {
  constructor(private readonly resolver: VideoResolver) {}

  async resolveVideo(url: string): Promise<ResolvedVideo> {
    const resolved = await this.resolver.resolve(url);

    if (!resolved.videos || resolved.videos.length === 0) {
      throw new AppError("VIDEO_UNAVAILABLE", "No downloadable video variants were found.");
    }

    return resolved;
  }
}
