import { describe, expect, it } from "vitest";
import { extractMediaUrl, platformForUrl } from "@/lib/media/platforms";

describe("extractMediaUrl", () => {
  it("returns a bare URL unchanged", () => {
    expect(extractMediaUrl("https://x.com/user/status/123")).toBe("https://x.com/user/status/123");
  });

  it("pulls the link out of share-sheet text", () => {
    expect(
      extractMediaUrl("Check out @natgeo's video! #fyp #animals https://vm.tiktok.com/ZMabc123/ ")
    ).toBe("https://vm.tiktok.com/ZMabc123/");
  });

  it("strips punctuation glued to the end of the link", () => {
    expect(extractMediaUrl("watch this: https://x.com/user/status/123.")).toBe(
      "https://x.com/user/status/123"
    );
    expect(extractMediaUrl("(see https://www.instagram.com/reel/abc123/)")).toBe(
      "https://www.instagram.com/reel/abc123/"
    );
    expect(extractMediaUrl("“https://x.com/user/status/123”")).toBe("https://x.com/user/status/123");
  });

  it("prefers a supported-platform link over an earlier unrelated one", () => {
    expect(
      extractMediaUrl("via https://example.com/blog — original: https://www.tiktok.com/@a/video/1")
    ).toBe("https://www.tiktok.com/@a/video/1");
  });

  it("falls back to the first well-formed link when none is on a supported platform", () => {
    expect(extractMediaUrl("look https://example.com/video")).toBe("https://example.com/video");
  });

  it("accepts a scheme-less link on a known host", () => {
    expect(extractMediaUrl("x.com/user/status/123")).toBe("https://x.com/user/status/123");
    expect(extractMediaUrl("try instagram.com/reel/abc123/ please")).toBe(
      "https://instagram.com/reel/abc123/"
    );
  });

  it("returns null when there's no link at all", () => {
    expect(extractMediaUrl("no links here")).toBeNull();
    expect(extractMediaUrl("")).toBeNull();
  });

  it("keeps query strings intact (e.g. Facebook's ?v=)", () => {
    expect(extractMediaUrl("https://www.facebook.com/watch/?v=647537299265662 wow")).toBe(
      "https://www.facebook.com/watch/?v=647537299265662"
    );
  });
});

describe("platformForUrl", () => {
  it("identifies every supported platform, including mirror/short hosts", () => {
    expect(platformForUrl("https://fxtwitter.com/a/status/1")).toBe("x");
    expect(platformForUrl("https://instagr.am/p/abc/")).toBe("instagram");
    expect(platformForUrl("https://vt.tiktok.com/abc/")).toBe("tiktok");
    expect(platformForUrl("https://fb.watch/abc/")).toBe("facebook");
    expect(platformForUrl("https://web.facebook.com/reel/1")).toBe("facebook");
  });

  it("returns undefined for unknown hosts, lookalikes, and non-URLs", () => {
    expect(platformForUrl("https://x.com.evil.example/a/status/1")).toBeUndefined();
    expect(platformForUrl("ftp://x.com/a")).toBeUndefined();
    expect(platformForUrl("not a url")).toBeUndefined();
  });
});
