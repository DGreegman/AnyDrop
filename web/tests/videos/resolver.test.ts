import { describe, expect, it } from "vitest";
import {
  classifyResolverFailure,
  normalizeYtDlpOutput,
  YtDlpOutput,
} from "@/lib/videos/resolver";
import { AppError } from "@/lib/videos/errors";

describe("normalizeYtDlpOutput", () => {
  it("normalizes progressive mp4 formats into sorted, deduped VideoVariants", () => {
    const raw: YtDlpOutput = {
      title: "A cool video",
      thumbnail: "https://pbs.twimg.com/thumb.jpg",
      duration: 12.6,
      extractor: "twitter",
      formats: [
        // HLS variant — should be excluded (not progressive).
        {
          format_id: "hls-206",
          ext: "mp4",
          protocol: "m3u8_native",
          width: 320,
          height: 372,
          url: "https://video.twimg.com/hls-206.m3u8",
        },
        // Audio-only track — should be excluded (no width/height).
        {
          format_id: "hls-audio-128000-Audio",
          ext: "mp4",
          vcodec: "none",
          url: "https://video.twimg.com/audio.mp4",
        },
        // Progressive, lower bitrate duplicate of the same quality — should
        // lose to the higher-bitrate one below.
        {
          format_id: "http-500",
          ext: "mp4",
          protocol: "https",
          width: 320,
          height: 372,
          tbr: 500,
          url: "https://video.twimg.com/low.mp4",
        },
        {
          format_id: "http-632",
          ext: "mp4",
          protocol: "https",
          width: 320,
          height: 372,
          tbr: 632,
          url: "https://video.twimg.com/320x372.mp4",
        },
        {
          format_id: "http-2176",
          ext: "mp4",
          protocol: "https",
          width: 720,
          height: 840,
          tbr: 2176,
          url: "https://video.twimg.com/720x840.mp4",
        },
      ],
    };

    const result = normalizeYtDlpOutput("https://x.com/user/status/1", raw);

    expect(result.title).toBe("A cool video");
    expect(result.thumbnail).toBe("https://pbs.twimg.com/thumb.jpg");
    expect(result.duration).toBe(13); // rounded
    expect(result.videos).toHaveLength(2);

    expect(result.videos[0]).toMatchObject({
      quality: "840p",
      width: 720,
      height: 840,
      bitrate: 2176000,
      format: "mp4",
      url: "https://video.twimg.com/720x840.mp4",
    });
    expect(result.videos[1]).toMatchObject({
      quality: "372p",
      bitrate: 632000,
      url: "https://video.twimg.com/320x372.mp4",
    });
  });

  it("throws VIDEO_UNAVAILABLE when there are no progressive video formats", () => {
    const raw: YtDlpOutput = {
      formats: [
        { format_id: "hls-audio", ext: "mp4", vcodec: "none", url: "https://video.twimg.com/a.mp4" },
      ],
    };

    try {
      normalizeYtDlpOutput("https://x.com/user/status/1", raw);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VIDEO_UNAVAILABLE");
    }
  });
});

describe("classifyResolverFailure", () => {
  it("maps 'no video could be found' to VIDEO_NOT_FOUND", () => {
    const err = classifyResolverFailure(
      "ERROR: [twitter] 123: No video could be found in this tweet"
    );
    expect(err.code).toBe("VIDEO_NOT_FOUND");
  });

  it("maps a private/suspended account message to VIDEO_UNAVAILABLE", () => {
    const err = classifyResolverFailure("ERROR: [twitter] 123: Account is temporarily unavailable");
    expect(err.code).toBe("VIDEO_UNAVAILABLE");
  });

  it("maps an unrecognized failure to VIDEO_RESOLUTION_FAILED", () => {
    const err = classifyResolverFailure("ERROR: something unexpected happened");
    expect(err.code).toBe("VIDEO_RESOLUTION_FAILED");
  });
});
