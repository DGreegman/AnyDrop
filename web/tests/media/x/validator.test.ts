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
