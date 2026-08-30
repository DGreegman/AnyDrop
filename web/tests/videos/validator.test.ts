import { describe, expect, it } from "vitest";
import { validateResolveRequest } from "@/lib/videos/validator";
import { AppError } from "@/lib/videos/errors";

describe("validateResolveRequest", () => {
  it("accepts a valid x.com status URL and normalizes it", () => {
    const result = validateResolveRequest({ url: "https://x.com/someuser/status/123456789" });
    expect(result.url).toBe("https://x.com/someuser/status/123456789");
  });

  it("accepts a valid twitter.com status URL and normalizes it to x.com", () => {
    const result = validateResolveRequest({
      url: "https://twitter.com/someuser/status/123456789",
    });
    expect(result.url).toBe("https://x.com/someuser/status/123456789");
  });

  it("rejects a missing url", () => {
    try {
      validateResolveRequest({});
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("INVALID_URL");
    }
  });

  it("rejects a malformed url", () => {
    try {
      validateResolveRequest({ url: "not a url" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("INVALID_URL");
    }
  });

  it("rejects an unsupported domain", () => {
    try {
      validateResolveRequest({ url: "https://example.com/someuser/status/123456789" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });

  it("rejects an x.com URL that is not a status URL", () => {
    try {
      validateResolveRequest({ url: "https://x.com/someuser" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });
});
