import { describe, expect, it } from "vitest";
import {
  classifyResolverFailure,
  normalizeYtDlpOutput,
  YtDlpOutput,
} from "@/lib/media/x/resolver";
import { AppError } from "@/lib/media/errors";

describe("normalizeYtDlpOutput", () => {
  it("normalizes progressive mp4 formats into a sorted, deduped ResolvedMedia", () => {
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
          acodec: "mp4a.40.2",
          url: "https://video.twimg.com/720x840.mp4",
        },
      ],
    };

    const result = normalizeYtDlpOutput("https://x.com/someuser/status/1", raw);

    expect(result.platform).toBe("x");
    expect(result.sourceUrl).toBe("https://x.com/someuser/status/1");
    expect(result.title).toBe("A cool video");
    expect(result.thumbnail).toBe("https://pbs.twimg.com/thumb.jpg");
    expect(result.duration).toBe(13); // rounded
    expect(result.author).toEqual({ username: "someuser" });
    expect(result.media).toHaveLength(2);

    // Sorted descending by height; acodec present and not "none" -> hasAudio.
    expect(result.media[0]).toMatchObject({
      quality: "840p",
      width: 720,
      height: 840,
      bitrate: 2176000,
      format: "mp4",
      hasAudio: true,
      url: "https://video.twimg.com/720x840.mp4",
    });
    // The higher-bitrate 372p variant won, not the 500kbps duplicate.
    // acodec was undefined on this format — treated as "has audio", not
    // "unknown/false" (same defensive convention as vcodec).
    expect(result.media[1]).toMatchObject({
      quality: "372p",
      bitrate: 632000,
      hasAudio: true,
      url: "https://video.twimg.com/320x372.mp4",
    });
  });

  it("omits `author` when the source URL doesn't carry a recognizable handle", () => {
    const raw: YtDlpOutput = {
      formats: [
        { format_id: "http-500", ext: "mp4", width: 320, height: 372, tbr: 500, url: "https://video.twimg.com/a.mp4" },
      ],
    };
    expect(normalizeYtDlpOutput("not-a-status-url", raw).author).toBeUndefined();
  });

  it("throws VIDEO_UNAVAILABLE when there are no progressive video formats", () => {
    const raw: YtDlpOutput = {
      formats: [
        { format_id: "hls-audio", ext: "mp4", vcodec: "none", url: "https://video.twimg.com/a.mp4" },
      ],
    };

    try {
      normalizeYtDlpOutput("https://x.com/someuser/status/1", raw);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VIDEO_UNAVAILABLE");
    }
  });
});

describe("normalizeYtDlpOutput — multi-video, GIFs, and on-demand variants", () => {
  // Shaped after a real two-video tweet (x.com/primevideouk/status/1578401165338976258):
  // each video is its own yt-dlp entry with progressive http-* files, an
  // HLS video stream, and an HLS audio stream (vcodec "none", acodec null).
  const entry = (n: number) => ({
    title: "Prime Video UK & IE - A new power will be forged.",
    thumbnail: `https://pbs.twimg.com/thumb${n}.jpg`,
    duration: 6.006,
    extractor: "twitter",
    playlist_index: n,
    uploader: "Prime Video UK & IE",
    uploader_id: "primevideouk",
    formats: [
      { format_id: "hls-audio-128000-Audio", ext: "mp4", protocol: "m3u8_native", vcodec: "none", acodec: null, tbr: 128, url: `https://video.twimg.com/${n}/audio.m3u8` },
      { format_id: "http-832", ext: "mp4", protocol: "https", width: 540, height: 540, tbr: 832, url: `https://video.twimg.com/${n}/540.mp4` },
      { format_id: "http-1280", ext: "mp4", protocol: "https", width: 720, height: 720, tbr: 1280, url: `https://video.twimg.com/${n}/720.mp4` },
      { format_id: "hls-772", ext: "mp4", protocol: "m3u8_native", vcodec: "avc1.64001F", acodec: "none", width: 720, height: 720, tbr: 772, url: `https://video.twimg.com/${n}/720.m3u8` },
    ],
  });
  const source = "https://x.com/primevideouk/status/1578401165338976258";

  it("returns every video in the post as an item, with top-level fields mirroring the first", () => {
    const result = normalizeYtDlpOutput(source, [entry(1), entry(2)], { canMerge: false });
    expect(result.items).toHaveLength(2);
    expect(result.items!.map((i) => i.index)).toEqual([1, 2]);
    expect(result.media).toBe(result.items![0].media);
    expect(result.thumbnail).toBe("https://pbs.twimg.com/thumb1.jpg");
    expect(result.items![1].media[0].url).toBe("https://video.twimg.com/2/720.mp4");
    expect(result.id).toBe("1578401165338976258");
  });

  it("omits `items` for a single-video post", () => {
    expect(normalizeYtDlpOutput(source, entry(1), { canMerge: false }).items).toBeUndefined();
  });

  it("doesn't offer a merged variant that's no better than an existing file, but does offer MP3", () => {
    const result = normalizeYtDlpOutput(source, [entry(1), entry(2)], { canMerge: true });
    const second = result.items![1].media;
    expect(second.some((v) => v.kind === "merged")).toBe(false); // HLS 720p == http 720p
    const audio = second.find((v) => v.kind === "audio")!;
    const url = new URL(audio.url);
    expect(url.searchParams.get("anydrop_format")).toBe("hls-audio-128000-Audio");
    expect(url.searchParams.get("anydrop_item")).toBe("2");
    expect(url.searchParams.get("anydrop_audio")).toBe("mp3");
  });

  it("serves an HLS-only video through a merged variant instead of failing", () => {
    const hlsOnly = {
      ...entry(1),
      playlist_index: null,
      formats: entry(1).formats.filter((f) => !f.format_id.startsWith("http-")),
    };
    const result = normalizeYtDlpOutput(source, hlsOnly, { canMerge: true });
    expect(result.media[0]).toMatchObject({ kind: "merged", quality: "720p", hasAudio: true });
    expect(new URL(result.media[0].url).searchParams.get("anydrop_item")).toBeNull();
    // ...and without ffmpeg it's still an honest failure.
    expect(() => normalizeYtDlpOutput(source, hlsOnly, { canMerge: false })).toThrow(AppError);
  });

  it("marks GIFs (served from /tweet_video/) as silent and offers no MP3 for them", () => {
    const gif = {
      extractor: "twitter",
      formats: [
        { format_id: "http-0", ext: "mp4", protocol: "https", width: 480, height: 270, url: "https://video.twimg.com/tweet_video/abc.mp4" },
      ],
    };
    const result = normalizeYtDlpOutput("https://x.com/a/status/1", gif, { canMerge: true });
    expect(result.media).toHaveLength(1);
    expect(result.media[0].hasAudio).toBe(false);
  });

  it("falls back to yt-dlp's uploader_id for handle-less /i/status links", () => {
    const result = normalizeYtDlpOutput("https://x.com/i/status/1578401165338976258", entry(1), {
      canMerge: false,
    });
    expect(result.author).toEqual({ username: "primevideouk", displayName: "Prime Video UK & IE" });
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

  it("maps an ended/deleted broadcast to VIDEO_UNAVAILABLE", () => {
    const err = classifyResolverFailure(
      "ERROR: [twitter:broadcast] 1rmxPMjLzAXKN: Broadcast no longer exists"
    );
    expect(err.code).toBe("VIDEO_UNAVAILABLE");
  });

  it("maps an unrecognized failure to VIDEO_RESOLUTION_FAILED", () => {
    const err = classifyResolverFailure("ERROR: something unexpected happened");
    expect(err.code).toBe("VIDEO_RESOLUTION_FAILED");
  });
});
