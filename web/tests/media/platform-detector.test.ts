import { describe, expect, it } from "vitest";
import { detectPlatform } from "@/lib/media/platform-detector";
import { AppError } from "@/lib/media/errors";

function expectPlatform(url: string, platform: string) {
  expect(detectPlatform(url)).toBe(platform);
}

function expectError(url: string, code: string) {
  try {
    detectPlatform(url);
    throw new Error(`expected detectPlatform(${url}) to throw`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

describe("detectPlatform", () => {
  it("recognizes x.com and twitter.com (and their www/mobile variants)", () => {
    expectPlatform("https://x.com/user/status/123", "x");
    expectPlatform("https://www.x.com/user/status/123", "x");
    expectPlatform("https://mobile.x.com/user/status/123", "x");
    expectPlatform("https://twitter.com/user/status/123", "x");
    expectPlatform("https://www.twitter.com/user/status/123", "x");
    expectPlatform("https://mobile.twitter.com/user/status/123", "x");
  });

  it("recognizes instagram.com and its www variant", () => {
    expectPlatform("https://instagram.com/reel/abc123", "instagram");
    expectPlatform("https://www.instagram.com/reel/abc123", "instagram");
  });

  it("recognizes tiktok.com and its www/m variants", () => {
    expectPlatform("https://tiktok.com/@user/video/123", "tiktok");
    expectPlatform("https://www.tiktok.com/@user/video/123", "tiktok");
    expectPlatform("https://m.tiktok.com/@user/video/123", "tiktok");
  });

  it("recognizes TikTok's vm./vt. share-link short domains", () => {
    expectPlatform("https://vm.tiktok.com/ZS4YoeRv2/", "tiktok");
    expectPlatform("https://vt.tiktok.com/ZSTD5bW7/", "tiktok");
  });

  it("recognizes facebook.com and its www/m/fb.watch variants", () => {
    expectPlatform("https://facebook.com/reel/123", "facebook");
    expectPlatform("https://www.facebook.com/reel/123", "facebook");
    expectPlatform("https://m.facebook.com/reel/123", "facebook");
    expectPlatform("https://fb.watch/abc123", "facebook");
  });

  it("is case-insensitive on hostname", () => {
    expectPlatform("https://X.COM/user/status/123", "x");
  });

  it("rejects an unsupported domain with UNSUPPORTED_URL", () => {
    expectError("https://example.com/user/status/123", "UNSUPPORTED_URL");
    expectError("https://youtube.com/watch?v=abc", "UNSUPPORTED_URL");
  });

  it("does not fall for a supported hostname smuggled in as a query param or subdomain", () => {
    // string.includes("x.com") would wrongly match both of these.
    expectError("https://evil.example/?u=x.com/status/123", "UNSUPPORTED_URL");
    expectError("https://x.com.evil.example/status/123", "UNSUPPORTED_URL");
  });

  it("rejects a malformed URL with INVALID_URL", () => {
    expectError("not a url", "INVALID_URL");
    expectError("", "INVALID_URL");
  });

  it("rejects a non-http(s) protocol with INVALID_URL", () => {
    expectError("ftp://x.com/user/status/123", "INVALID_URL");
  });
});
