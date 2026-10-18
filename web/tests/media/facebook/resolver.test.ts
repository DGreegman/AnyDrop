import { describe, expect, it } from "vitest";
import {
  classifyResolverFailure,
  normalizeYtDlpOutput,
  YtDlpOutput,
} from "@/lib/media/facebook/resolver";
import { AppError } from "@/lib/media/errors";

// Shaped after a real public video's --dump-json (facebook.com/watch/?v=647537299265662):
// hd/sd progressive files with no metadata, DASH video-only streams with
// real dimensions, and one DASH audio-only stream.
const raw: YtDlpOutput = {
  title: "Padre enseña a su hijo a cómo bañar un recién nacido",
  thumbnail: "https://scontent.fbni1-2.fna.fbcdn.net/thumb.jpg",
  duration: 136.179,
  extractor: "facebook",
  uploader: "InfoPico",
  formats: [
    { format_id: "946537014817549a", ext: "m4a", protocol: "https", vcodec: "none", acodec: "mp4a.40.5", tbr: 45.5, url: "https://video.fbni1-2.fna.fbcdn.net/a.m4a" },
    { format_id: "sd", ext: "mp4", protocol: "https", url: "https://video.fbni1-2.fna.fbcdn.net/sd.mp4" },
    { format_id: "hd", ext: "mp4", protocol: "https", url: "https://video.fbni1-2.fna.fbcdn.net/hd.mp4" },
    { format_id: "741818234911414v", ext: "mp4", protocol: "https", vcodec: "vp09.00.21.08", acodec: "none", width: 360, height: 640, tbr: 284.7, url: "https://video.fbni1-1.fna.fbcdn.net/360.mp4" },
    { format_id: "2101075653735394v", ext: "mp4", protocol: "https", vcodec: "vp09.00.31.08", acodec: "none", width: 720, height: 1280, tbr: 1211.9, url: "https://video.fbni1-2.fna.fbcdn.net/720.mp4" },
  ],
};
const sourceUrl = "https://www.facebook.com/watch/?v=647537299265662";

describe("normalizeYtDlpOutput (Facebook)", () => {
  it("offers hd then sd as plain files, labelled honestly (no invented resolution)", () => {
    const result = normalizeYtDlpOutput(sourceUrl, raw, { canMerge: false });
    expect(result.platform).toBe("facebook");
    expect(result.id).toBe("647537299265662");
    expect(result.media.map((v) => v.quality)).toEqual(["HD", "SD"]);
    expect(result.media[0]).toMatchObject({
      url: "https://video.fbni1-2.fna.fbcdn.net/hd.mp4",
      hasAudio: true,
      kind: "file",
    });
    expect(result.duration).toBe(136);
    expect(result.author).toEqual({ displayName: "InfoPico" });
  });

  it("with ffmpeg, adds a merged best-quality variant first and an MP3 last", () => {
    const result = normalizeYtDlpOutput(sourceUrl, raw, { canMerge: true });
    expect(result.media.map((v) => v.kind)).toEqual(["merged", "file", "file", "audio"]);
    expect(result.media[0]).toMatchObject({ quality: "1280p", width: 720, height: 1280, hasAudio: true });
    expect(new URL(result.media[0].url).searchParams.get("anydrop_format")).toBe(
      "2101075653735394v+946537014817549a"
    );
    const audio = new URL(result.media[3].url);
    expect(audio.searchParams.get("anydrop_format")).toBe("946537014817549a");
    expect(audio.searchParams.get("anydrop_audio")).toBe("mp3");
  });

  it("marks hd/sd silent when the video has DASH streams but no audio stream (a real silent reel)", () => {
    const silent: YtDlpOutput = {
      ...raw,
      formats: raw.formats!.filter((f) => f.format_id !== "946537014817549a"),
    };
    const result = normalizeYtDlpOutput(sourceUrl, silent, { canMerge: true });
    expect(result.media.every((v) => v.kind === "file" && v.hasAudio === false)).toBe(true);
  });

  it("decodes HTML entities yt-dlp passes through in titles/uploader", () => {
    const result = normalizeYtDlpOutput(sourceUrl, {
      ...raw,
      title: "9.8K views &#xb7; 341 reactions",
      uploader: "Beast &amp; Camp",
    });
    expect(result.title).toBe("9.8K views · 341 reactions");
    expect(result.author?.displayName).toBe("Beast & Camp");
  });

  it("throws VIDEO_UNAVAILABLE when there's nothing playable", () => {
    expect(() =>
      normalizeYtDlpOutput(sourceUrl, { formats: [] }, { canMerge: false })
    ).toThrow(AppError);
  });
});

describe("classifyResolverFailure (Facebook)", () => {
  it("maps 'Cannot parse data' (what logged-out requests get) to VIDEO_UNAVAILABLE", () => {
    expect(classifyResolverFailure("ERROR: [facebook] 1: Cannot parse data; please report").code).toBe(
      "VIDEO_UNAVAILABLE"
    );
  });

  it("maps an unsupported redirect target (dead share code) to VIDEO_NOT_FOUND", () => {
    expect(classifyResolverFailure("ERROR: Unsupported URL: https://web.facebook.com/watch/").code).toBe(
      "VIDEO_NOT_FOUND"
    );
  });

  it("maps an unrecognized failure to VIDEO_RESOLUTION_FAILED", () => {
    expect(classifyResolverFailure("ERROR: something new").code).toBe("VIDEO_RESOLUTION_FAILED");
  });
});
