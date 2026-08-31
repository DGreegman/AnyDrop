import { describe, expect, it } from "vitest";
import { normalizeInstagramUrl } from "@/lib/media/instagram/validator";
import { AppError } from "@/lib/media/errors";

describe("normalizeInstagramUrl", () => {
  it("normalizes a bare /reel/<id> URL to the canonical www.instagram.com form", () => {
    expect(normalizeInstagramUrl("https://instagram.com/reel/DJQJeVQPnI4/")).toBe(
      "https://www.instagram.com/reel/DJQJeVQPnI4/"
    );
  });

  it("normalizes a /<username>/reel/<id> URL, dropping the username", () => {
    expect(normalizeInstagramUrl("https://www.instagram.com/natgeo/reel/DE2pTIdscUf/")).toBe(
      "https://www.instagram.com/reel/DE2pTIdscUf/"
    );
  });

  it("normalizes a URL without a trailing slash", () => {
    expect(normalizeInstagramUrl("https://www.instagram.com/reel/DJQJeVQPnI4")).toBe(
      "https://www.instagram.com/reel/DJQJeVQPnI4/"
    );
  });

  it("ignores query params (e.g. Instagram's igsh share tracking param)", () => {
    expect(normalizeInstagramUrl("https://www.instagram.com/reel/DJQJeVQPnI4/?igsh=abc123")).toBe(
      "https://www.instagram.com/reel/DJQJeVQPnI4/"
    );
  });

  it("rejects a non-Reel URL (e.g. a bare profile page)", () => {
    try {
      normalizeInstagramUrl("https://www.instagram.com/natgeo/");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });

  it("rejects a regular post URL (/p/...) — out of scope for this phase", () => {
    try {
      normalizeInstagramUrl("https://www.instagram.com/p/DJQJeVQPnI4/");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
    }
  });
});
