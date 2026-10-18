import { describe, expect, it } from "vitest";
import { facebookVideoId, normalizeFacebookUrl } from "@/lib/media/facebook/validator";
import { AppError } from "@/lib/media/errors";

describe("normalizeFacebookUrl", () => {
  it.each([
    ["https://www.facebook.com/reel/1195289147628387/?mibextid=abc", "https://www.facebook.com/reel/1195289147628387"],
    ["https://m.facebook.com/reel/1195289147628387", "https://www.facebook.com/reel/1195289147628387"],
    ["https://www.facebook.com/watch/?v=647537299265662&ref=sharing", "https://www.facebook.com/watch/?v=647537299265662"],
    ["https://www.facebook.com/watch?v=647537299265662", "https://www.facebook.com/watch/?v=647537299265662"],
    ["https://www.facebook.com/watch/live/?v=1823658634322275", "https://www.facebook.com/watch/?v=1823658634322275"],
    ["https://www.facebook.com/video.php?v=637842556329505&fref=nf", "https://www.facebook.com/watch/?v=637842556329505"],
    ["https://web.facebook.com/radiokicksfm/videos/3676516585958356/", "https://www.facebook.com/radiokicksfm/videos/3676516585958356/"],
    ["https://www.facebook.com/ChristyClarkForBC/videos/vb.22819070941/10153870694020942/?type=2", "https://www.facebook.com/ChristyClarkForBC/videos/10153870694020942/"],
    ["https://www.facebook.com/attn/posts/pfbid0j1Czf2gGDVqeQ8KiMLFm3pWN8GxsQmeRrVhimWDzMuKQoR8r4b1knNsejELmUgyhl", "https://www.facebook.com/attn/posts/pfbid0j1Czf2gGDVqeQ8KiMLFm3pWN8GxsQmeRrVhimWDzMuKQoR8r4b1knNsejELmUgyhl/"],
    ["https://www.facebook.com/groups/1024490957622648/permalink/1396382447100162/", "https://www.facebook.com/groups/1024490957622648/permalink/1396382447100162/"],
    ["https://www.facebook.com/story.php?story_fbid=pfbid0Fnz&id=100073071055552&rdid=x", "https://www.facebook.com/story.php?story_fbid=pfbid0Fnz&id=100073071055552"],
    ["https://www.facebook.com/share/v/1A2b3C4d5E/", "https://www.facebook.com/share/v/1A2b3C4d5E/"],
    ["https://www.facebook.com/share/r/1A2b3C4d5E", "https://www.facebook.com/share/r/1A2b3C4d5E/"],
    ["https://fb.watch/abc123XYZ/", "https://fb.watch/abc123XYZ/"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeFacebookUrl(input)).toBe(expected);
    // Idempotent: the canonical form normalizes to itself.
    expect(normalizeFacebookUrl(expected)).toBe(expected);
  });

  it.each([
    "https://www.facebook.com/",
    "https://www.facebook.com/somepage",
    "https://www.facebook.com/watch/?v=notanumber",
    "https://www.facebook.com/settings",
    "https://fb.watch/",
  ])("rejects %s", (input) => {
    try {
      normalizeFacebookUrl(input);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });
});

describe("facebookVideoId", () => {
  it("reads the id from ?v=, /reel/, and /videos/ URLs", () => {
    expect(facebookVideoId("https://www.facebook.com/watch/?v=647537299265662")).toBe("647537299265662");
    expect(facebookVideoId("https://www.facebook.com/reel/1195289147628387")).toBe("1195289147628387");
    expect(facebookVideoId("https://www.facebook.com/cnn/videos/10155529876156509/")).toBe("10155529876156509");
    expect(facebookVideoId("https://fb.watch/abc/")).toBeUndefined();
  });
});
