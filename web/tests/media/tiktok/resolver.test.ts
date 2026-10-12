import { describe, expect, it } from "vitest";
import {
  classifyResolverFailure,
  normalizeYtDlpOutput,
  YtDlpOutput,
} from "@/lib/media/tiktok/resolver";
import { AppError } from "@/lib/media/errors";

describe("normalizeYtDlpOutput", () => {
  // Shaped to match a real video's --dump-json output (verified against
  // several real public TikTok videos, not assumed): unlike Instagram,
  // TikTok's progressive formats DO carry real width/height/bitrate —
  // each quality tier is just listed twice, once per CDN mirror host.
  const raw: YtDlpOutput = {
    title: "Rock hyraxes look like rodents",
    duration: 98,
    extractor: "TikTok",
    uploader: "natgeo",
    channel: "National Geographic",
    formats: [
      {
        format_id: "audio",
        ext: "mp3",
        vcodec: "none",
        acodec: "mp3",
        url: "https://v45.tiktokcdn.com/audio.mp3",
      },
      {
        format_id: "h264_540p_790563-0",
        ext: "mp4",
        vcodec: "h264",
        acodec: "aac",
        width: 576,
        height: 1024,
        tbr: 790,
        url: "https://v16-webapp-prime.tiktok.com/540p-a.mp4",
      },
      {
        // Same quality tier, mirror host — should be deduped away.
        format_id: "h264_540p_790563-1",
        ext: "mp4",
        vcodec: "h264",
        acodec: "aac",
        width: 576,
        height: 1024,
        tbr: 790,
        url: "https://v19-webapp-prime.tiktok.com/540p-b.mp4",
      },
      {
        format_id: "bytevc1_720p_650528-0",
        ext: "mp4",
        vcodec: "h265",
        acodec: "aac",
        width: 720,
        height: 1280,
        tbr: 650,
        url: "https://v16-webapp-prime.tiktok.com/720p-a.mp4",
      },
    ],
  };

  it("returns one deduped variant per real quality tier, using a passthrough URL", () => {
    const result = normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/7595589117723954487", raw);

    expect(result.platform).toBe("tiktok");
    const videos = result.media.filter((v) => v.kind !== "audio");
    expect(videos).toHaveLength(2); // 540p and 720p, mirror duplicate dropped

    expect(result.media[0]).toMatchObject({
      quality: "1280p",
      width: 720,
      height: 1280,
      bitrate: 650000,
      format: "mp4",
      hasAudio: true,
    });
    // Not the raw CDN URL — a passthrough to the source page + format id.
    expect(result.media[0].url).toBe(
      "https://www.tiktok.com/@natgeo/video/7595589117723954487?xdrop_format=bytevc1_720p_650528-0"
    );

    expect(result.media[1]).toMatchObject({ quality: "1024p", width: 576, height: 1024 });
  });

  it("populates author from uploader (username) and channel (display name) — opposite of Instagram's field mapping", () => {
    const result = normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/1", raw);
    expect(result.author).toEqual({ username: "natgeo", displayName: "National Geographic" });
  });

  it("uses the real duration TikTok reliably reports (unlike Instagram)", () => {
    const result = normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/1", raw);
    expect(result.duration).toBe(98);
  });

  it("offers TikTok's own MP3 soundtrack as an audio variant, without needing ffmpeg", () => {
    const result = normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/7595589117723954487", raw, {
      canMerge: false,
    });
    const audio = result.media.filter((v) => v.kind === "audio");
    expect(audio).toHaveLength(1);
    expect(audio[0]).toMatchObject({ format: "mp3", hasAudio: true });
    expect(audio[0].url).toBe(
      "https://www.tiktok.com/@natgeo/video/7595589117723954487?xdrop_format=audio&xdrop_audio=copy"
    );
    // The audio variant sorts after every video variant.
    expect(result.media[result.media.length - 1].kind).toBe("audio");
  });

  it("passes the thumbnail through (TikTok's cover-image CDN is fetchable, unlike its video CDN)", () => {
    const withThumb: YtDlpOutput = { ...raw, thumbnail: "https://p16-common-sign.tiktokcdn.com/cover.jpg" };
    const result = normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/1", withThumb);
    expect(result.thumbnail).toBe("https://p16-common-sign.tiktokcdn.com/cover.jpg");
  });

  it("reports the video id", () => {
    const result = normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/7595589117723954487", raw);
    expect(result.id).toBe("7595589117723954487");
  });

  it("throws VIDEO_UNAVAILABLE when there's no progressive (audio+video) format at all", () => {
    const audioOnly: YtDlpOutput = {
      formats: [{ format_id: "audio", ext: "mp3", vcodec: "none", acodec: "mp3", url: "https://v45.tiktokcdn.com/a.mp3" }],
    };
    try {
      normalizeYtDlpOutput("https://www.tiktok.com/@natgeo/video/1", audioOnly);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VIDEO_UNAVAILABLE");
    }
  });
});

describe("classifyResolverFailure", () => {
  it("maps an extraction failure to VIDEO_NOT_FOUND", () => {
    // Verified against real yt-dlp output for a nonexistent video ID.
    const err = classifyResolverFailure(
      "ERROR: [TikTok] 1111111111111111111: Unable to extract universal data for rehydration"
    );
    expect(err.code).toBe("VIDEO_NOT_FOUND");
  });

  it("maps a private/removed message to VIDEO_UNAVAILABLE", () => {
    const err = classifyResolverFailure("ERROR: [TikTok] 123: This video is private");
    expect(err.code).toBe("VIDEO_UNAVAILABLE");
  });

  it("maps an unrecognized failure to VIDEO_RESOLUTION_FAILED", () => {
    const err = classifyResolverFailure("ERROR: something unexpected happened");
    expect(err.code).toBe("VIDEO_RESOLUTION_FAILED");
  });
});
