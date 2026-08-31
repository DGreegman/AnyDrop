import { describe, expect, it } from "vitest";
import {
  classifyResolverFailure,
  normalizeYtDlpOutput,
  YtDlpOutput,
} from "@/lib/media/instagram/resolver";
import { AppError } from "@/lib/media/errors";

describe("normalizeYtDlpOutput", () => {
  // Shaped to match a real Reel's --dump-json output (verified against
  // several real public Reels, not assumed): the same progressive
  // (video+audio) file listed 2-3x under different bare-numeric
  // format_ids with no dimension metadata, alongside DASH video-only and
  // audio-only streams that DO carry real dimensions/bitrate.
  const raw: YtDlpOutput = {
    title: "Video by natgeo",
    description: "Some caption text #hashtag",
    thumbnail: "https://instagram.fbni1-2.fna.fbcdn.net/thumb.jpg",
    duration: undefined,
    extractor: "Instagram",
    channel: "natgeo",
    uploader: "National Geographic",
    formats: [
      {
        format_id: "dash-audio",
        ext: "mp4",
        vcodec: "none",
        acodec: "mp4a.40.5",
        url: "https://instagram.fbni1-1.fna.fbcdn.net/audio.mp4",
      },
      {
        format_id: "1",
        ext: "mp4",
        protocol: "https",
        url: "https://instagram.fbni1-1.fna.fbcdn.net/progressive.mp4",
      },
      {
        format_id: "2",
        ext: "mp4",
        protocol: "https",
        url: "https://instagram.fbni1-1.fna.fbcdn.net/progressive.mp4", // same URL as "1"
      },
      {
        format_id: "3",
        ext: "mp4",
        protocol: "https",
        url: "https://instagram.fbni1-1.fna.fbcdn.net/progressive.mp4", // same URL again
      },
      {
        format_id: "dash-360",
        ext: "mp4",
        vcodec: "avc1.4d001e",
        acodec: "none",
        width: 360,
        height: 640,
        tbr: 295.455,
        url: "https://instagram.fbni1-1.fna.fbcdn.net/dash-360.mp4",
      },
      {
        format_id: "dash-720",
        ext: "mp4",
        vcodec: "avc1.64001f",
        acodec: "none",
        width: 720,
        height: 1280,
        tbr: 1163.114,
        url: "https://instagram.fbni1-1.fna.fbcdn.net/dash-720.mp4",
      },
    ],
  };

  it("returns exactly one deduped progressive variant, ignoring DASH-only streams", () => {
    const result = normalizeYtDlpOutput("https://www.instagram.com/reel/abc123/", raw);

    expect(result.platform).toBe("instagram");
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({
      url: "https://instagram.fbni1-1.fna.fbcdn.net/progressive.mp4",
      quality: "original",
      hasAudio: true,
      format: "mp4",
    });
    // Genuinely unknown for this file — must not be borrowed from the
    // DASH streams' dimensions.
    expect(result.media[0].width).toBeUndefined();
    expect(result.media[0].height).toBeUndefined();
  });

  it("populates author from channel (username) and uploader (display name)", () => {
    const result = normalizeYtDlpOutput("https://www.instagram.com/reel/abc123/", raw);
    expect(result.author).toEqual({ username: "natgeo", displayName: "National Geographic" });
  });

  it("omits duration when yt-dlp doesn't report one (the common case for Reels)", () => {
    const result = normalizeYtDlpOutput("https://www.instagram.com/reel/abc123/", raw);
    expect(result.duration).toBeUndefined();
  });

  it("uses a real height-based quality label when one genuinely is attached to a progressive format", () => {
    const withHeight: YtDlpOutput = {
      formats: [
        {
          format_id: "1",
          ext: "mp4",
          width: 720,
          height: 1280,
          tbr: 1500,
          url: "https://instagram.fbni1-1.fna.fbcdn.net/full.mp4",
        },
      ],
    };
    const result = normalizeYtDlpOutput("https://www.instagram.com/reel/abc123/", withHeight);
    expect(result.media[0]).toMatchObject({ quality: "1280p", width: 720, height: 1280 });
  });

  it("throws VIDEO_UNAVAILABLE when there's no progressive (audio+video) format at all", () => {
    const audioVideoOnlySplit: YtDlpOutput = {
      formats: [
        { format_id: "a", ext: "mp4", vcodec: "none", acodec: "mp4a.40.5", url: "https://x.fbcdn.net/a.mp4" },
        { format_id: "v", ext: "mp4", vcodec: "avc1", acodec: "none", width: 720, height: 1280, url: "https://x.fbcdn.net/v.mp4" },
      ],
    };
    try {
      normalizeYtDlpOutput("https://www.instagram.com/reel/abc123/", audioVideoOnlySplit);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VIDEO_UNAVAILABLE");
    }
  });
});

describe("classifyResolverFailure", () => {
  it("maps Instagram's login-gated/empty-response message to VIDEO_UNAVAILABLE", () => {
    // Verified against real yt-dlp output for a nonexistent Reel — the
    // same message Instagram returns for content requiring login, which
    // is exactly why this maps to UNAVAILABLE, not NOT_FOUND: XDrop can't
    // tell the two apart without authenticating, and won't.
    const err = classifyResolverFailure(
      "ERROR: [Instagram] ABC123: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in."
    );
    expect(err.code).toBe("VIDEO_UNAVAILABLE");
  });

  it("maps audience-restricted content to VIDEO_UNAVAILABLE", () => {
    // Verified against real yt-dlp output for a real, publicly-linked
    // Reel that Instagram won't serve to a logged-out request.
    const err = classifyResolverFailure(
      "ERROR: [Instagram] DcrOmvnh_3I: This content isn't available to everyone: It can't be seen by certain audiences."
    );
    expect(err.code).toBe("VIDEO_UNAVAILABLE");
  });

  it("maps an extraction failure (e.g. a non-Reel Instagram URL) to VIDEO_NOT_FOUND", () => {
    // Verified against real yt-dlp output for a profile-page URL.
    const err = classifyResolverFailure(
      "ERROR: [instagram:user] nasa: Unable to extract data"
    );
    expect(err.code).toBe("VIDEO_NOT_FOUND");
  });

  it("maps an unrecognized failure to VIDEO_RESOLUTION_FAILED", () => {
    const err = classifyResolverFailure("ERROR: something unexpected happened");
    expect(err.code).toBe("VIDEO_RESOLUTION_FAILED");
  });
});
