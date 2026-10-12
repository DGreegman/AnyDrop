import { describe, expect, it } from "vitest";
import { normalizeXUrl } from "@/lib/media/x/validator";
import { AppError } from "@/lib/media/errors";

describe("normalizeXUrl", () => {
  it("normalizes an x.com status URL to itself", () => {
    expect(normalizeXUrl("https://x.com/someuser/status/123456789")).toBe(
      "https://x.com/someuser/status/123456789"
    );
  });

  it("normalizes a twitter.com status URL to x.com", () => {
    expect(normalizeXUrl("https://twitter.com/someuser/status/123456789")).toBe(
      "https://x.com/someuser/status/123456789"
    );
  });

  it("normalizes www/mobile host variants and trailing path segments to the canonical form", () => {
    expect(normalizeXUrl("https://www.x.com/someuser/status/123456789/photo/1")).toBe(
      "https://x.com/someuser/status/123456789"
    );
    expect(normalizeXUrl("https://mobile.twitter.com/someuser/statuses/123456789")).toBe(
      "https://x.com/someuser/status/123456789"
    );
  });

  it("normalizes handle-less /i/web/status and /i/status links", () => {
    expect(normalizeXUrl("https://x.com/i/web/status/1578401165338976258")).toBe(
      "https://x.com/i/status/1578401165338976258"
    );
    expect(normalizeXUrl("https://twitter.com/i/status/1578401165338976258")).toBe(
      "https://x.com/i/status/1578401165338976258"
    );
  });

  it("normalizes fxtwitter-style mirror links to x.com", () => {
    expect(normalizeXUrl("https://fxtwitter.com/primevideouk/status/1578401165338976258")).toBe(
      "https://x.com/primevideouk/status/1578401165338976258"
    );
    expect(normalizeXUrl("https://vxtwitter.com/someuser/status/1/video/2")).toBe(
      "https://x.com/someuser/status/1"
    );
  });

  it("is idempotent — a canonical URL normalizes to itself", () => {
    for (const url of ["https://x.com/someuser/status/1", "https://x.com/i/status/1"]) {
      expect(normalizeXUrl(url)).toBe(url);
    }
  });

  it("rejects a URL that isn't a status/post URL", () => {
    try {
      normalizeXUrl("https://x.com/someuser");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });
});
