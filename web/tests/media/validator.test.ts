import { describe, expect, it } from "vitest";
import { validateResolveRequest } from "@/lib/media/validator";
import { AppError } from "@/lib/media/errors";

describe("validateResolveRequest", () => {
  it("passes through a non-empty url string unchanged", () => {
    const result = validateResolveRequest({ url: "https://x.com/someuser/status/123456789" });
    expect(result.url).toBe("https://x.com/someuser/status/123456789");
  });

  it("trims whitespace", () => {
    const result = validateResolveRequest({ url: "  https://x.com/someuser/status/1  " });
    expect(result.url).toBe("https://x.com/someuser/status/1");
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

  it("rejects a non-string url", () => {
    try {
      validateResolveRequest({ url: 12345 });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("INVALID_URL");
    }
  });

  it("rejects an empty-string url", () => {
    try {
      validateResolveRequest({ url: "   " });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("INVALID_URL");
    }
  });

  it("extracts the link from share-sheet text", () => {
    const result = validateResolveRequest({
      url: "Check out this video! https://vm.tiktok.com/ZMabc123/ #fyp",
    });
    expect(result.url).toBe("https://vm.tiktok.com/ZMabc123/");
  });

  it("rejects absurdly long input", () => {
    expect(() => validateResolveRequest({ url: "a".repeat(5000) })).toThrow(AppError);
  });

  it("does not itself reject a malformed or unsupported URL — that's platform-detector's job", () => {
    // Deliberately not a real URL — validateResolveRequest only checks
    // the request body shape, not the URL's validity.
    const result = validateResolveRequest({ url: "not-a-url" });
    expect(result.url).toBe("not-a-url");
  });
});
