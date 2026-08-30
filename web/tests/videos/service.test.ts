import { describe, expect, it } from "vitest";
import { VideoService } from "@/lib/videos/service";
import { ResolvedVideo, VideoResolver } from "@/lib/videos/types";
import { AppError } from "@/lib/videos/errors";

function fakeResolver(impl: VideoResolver["resolve"]): VideoResolver {
  return { resolve: impl };
}

const sampleVideo: ResolvedVideo = {
  sourceUrl: "https://x.com/user/status/1",
  title: "Sample",
  duration: 10,
  videos: [{ quality: "720p", format: "mp4", url: "https://video.twimg.com/a.mp4" }],
};

describe("VideoService.resolveVideo", () => {
  it("returns the resolver's normalized data on success", async () => {
    const service = new VideoService(fakeResolver(async () => sampleVideo));
    const result = await service.resolveVideo("https://x.com/user/status/1");
    expect(result).toEqual(sampleVideo);
  });

  it("propagates a resolver failure as-is", async () => {
    const service = new VideoService(
      fakeResolver(async () => {
        throw new AppError("VIDEO_NOT_FOUND", "This post does not contain a video.");
      })
    );

    await expect(service.resolveVideo("https://x.com/user/status/1")).rejects.toMatchObject({
      code: "VIDEO_NOT_FOUND",
    });
  });

  it("rejects with VIDEO_UNAVAILABLE if the resolver returns no variants", async () => {
    const service = new VideoService(fakeResolver(async () => ({ ...sampleVideo, videos: [] })));

    await expect(service.resolveVideo("https://x.com/user/status/1")).rejects.toMatchObject({
      code: "VIDEO_UNAVAILABLE",
    });
  });
});
