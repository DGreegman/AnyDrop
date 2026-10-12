import { describe, expect, it } from "vitest";
import { parsePassthroughUrl } from "@/lib/media/passthrough";
import { safeFilename } from "@/lib/media/download";

const parse = (url: string) => parsePassthroughUrl(new URL(url));

describe("parsePassthroughUrl", () => {
  it("accepts the TikTok shape the resolver has always produced", () => {
    expect(
      parse("https://www.tiktok.com/@natgeo/video/7595589117723954487?xdrop_format=bytevc1_720p_650528-0")
    ).toEqual({
      platform: "tiktok",
      pageUrl: "https://www.tiktok.com/@natgeo/video/7595589117723954487",
      formatSpec: "bytevc1_720p_650528-0",
      item: undefined,
      audio: undefined,
    });
  });

  it("accepts merged (video+audio) selectors, items, and audio modes on every platform", () => {
    expect(
      parse("https://www.instagram.com/p/DJQJeVQPnI4/?xdrop_format=dash-670913965512136v%2Bdash-1337347094519360a")
    ).toMatchObject({ platform: "instagram", formatSpec: "dash-670913965512136v+dash-1337347094519360a" });
    expect(
      parse("https://x.com/primevideouk/status/1578401165338976258?xdrop_format=hls-audio-128000-Audio&xdrop_item=2&xdrop_audio=mp3")
    ).toMatchObject({ platform: "x", item: 2, audio: "mp3" });
  });

  it.each([
    ["no format selector", "https://www.tiktok.com/@natgeo/video/1"],
    ["a flag-shaped selector", "https://www.tiktok.com/@natgeo/video/1?xdrop_format=-rm%20-rf"],
    ["a free-form selector expression", "https://x.com/a/status/1?xdrop_format=best%5Bheight%3C720%5D"],
    ["more than one '+'", "https://x.com/a/status/1?xdrop_format=a%2Bb%2Bc"],
    ["an out-of-range item", "https://x.com/a/status/1?xdrop_format=hd&xdrop_item=99"],
    ["an unknown audio mode", "https://x.com/a/status/1?xdrop_format=hd&xdrop_audio=wav"],
    ["a non-canonical page URL (extra params)", "https://x.com/a/status/1?s=20&xdrop_format=http-832"],
    ["a non-canonical page URL (other path)", "https://www.tiktok.com/@natgeo?xdrop_format=audio"],
    ["an unknown host", "https://example.com/a/status/1?xdrop_format=hd"],
    ["a lookalike host", "https://x.com.evil.example/a/status/1?xdrop_format=hd"],
  ])("rejects %s", (_label, url) => {
    expect(parse(url)).toBeNull();
  });
});

describe("safeFilename", () => {
  it("uses the client's suggested name, reduced to a safe charset", () => {
    expect(safeFilename("720p", "tiktok-natgeo-7595589117723954487-720p")).toBe(
      "tiktok-natgeo-7595589117723954487-720p.mp4"
    );
    expect(safeFilename("Audio", 'x-"evil"/../name', "mp3")).toBe("x-evil-..-name.mp3");
  });

  it("falls back to the quality label when no name is given", () => {
    expect(safeFilename("720p")).toBe("xdrop-720p.mp4");
    expect(safeFilename(undefined, "///")).toBe("xdrop-video.mp4");
  });
});
