import { describe, expect, it } from "vitest";
import { normalizeTikTokUrl } from "@/lib/media/tiktok/validator";
import { AppError } from "@/lib/media/errors";

describe("normalizeTikTokUrl", () => {
  it("normalizes a www.tiktok.com video URL to itself", () => {
    expect(normalizeTikTokUrl("https://www.tiktok.com/@natgeo/video/7595589117723954487")).toBe(
      "https://www.tiktok.com/@natgeo/video/7595589117723954487"
    );
  });

  it("normalizes a bare tiktok.com (no www) video URL to the www form", () => {
    expect(normalizeTikTokUrl("https://tiktok.com/@natgeo/video/7595589117723954487")).toBe(
      "https://www.tiktok.com/@natgeo/video/7595589117723954487"
    );
  });

  it("drops trailing path segments and query params", () => {
    expect(
      normalizeTikTokUrl("https://www.tiktok.com/@natgeo/video/7595589117723954487?is_from_webapp=1&sender_device=pc")
    ).toBe("https://www.tiktok.com/@natgeo/video/7595589117723954487");
  });

  it("accepts usernames with periods (a real TikTok username shape)", () => {
    expect(normalizeTikTokUrl("https://www.tiktok.com/@user.name/video/123")).toBe(
      "https://www.tiktok.com/@user.name/video/123"
    );
  });

  it("passes a vm.tiktok.com short link through unchanged", () => {
    expect(normalizeTikTokUrl("https://vm.tiktok.com/ZS4YoeRv2/")).toBe(
      "https://vm.tiktok.com/ZS4YoeRv2/"
    );
  });

  it("passes a vt.tiktok.com short link through unchanged", () => {
    expect(normalizeTikTokUrl("https://vt.tiktok.com/ZSTD5bW7/")).toBe(
      "https://vt.tiktok.com/ZSTD5bW7/"
    );
  });

  it("rejects a short-link host with no code (bare root path)", () => {
    try {
      normalizeTikTokUrl("https://vm.tiktok.com/");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });

  it("rejects a non-video URL (e.g. a bare profile page)", () => {
    try {
      normalizeTikTokUrl("https://www.tiktok.com/@natgeo");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });
});
