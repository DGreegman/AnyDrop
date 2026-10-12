import { describe, expect, it } from "vitest";
import { isInstagramShareLink, normalizeInstagramUrl } from "@/lib/media/instagram/validator";
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

  it("accepts regular posts (/p/), IGTV (/tv/), and /reels/ (plural), with or without a username", () => {
    expect(normalizeInstagramUrl("https://www.instagram.com/p/DJQJeVQPnI4/")).toBe(
      "https://www.instagram.com/p/DJQJeVQPnI4/"
    );
    expect(normalizeInstagramUrl("https://www.instagram.com/alpha_expeditions/p/DJQJeVQPnI4")).toBe(
      "https://www.instagram.com/p/DJQJeVQPnI4/"
    );
    expect(normalizeInstagramUrl("https://www.instagram.com/tv/BkfuX9UB-eK/")).toBe(
      "https://www.instagram.com/tv/BkfuX9UB-eK/"
    );
    expect(normalizeInstagramUrl("https://www.instagram.com/reels/Cop84x6u7CP/")).toBe(
      "https://www.instagram.com/reel/Cop84x6u7CP/"
    );
  });

  it("normalizes instagr.am short links to www.instagram.com", () => {
    expect(normalizeInstagramUrl("https://instagr.am/p/DJQJeVQPnI4/")).toBe(
      "https://www.instagram.com/p/DJQJeVQPnI4/"
    );
  });

  it("is idempotent — a canonical URL normalizes to itself", () => {
    for (const url of [
      "https://www.instagram.com/reel/DJQJeVQPnI4/",
      "https://www.instagram.com/p/DJQJeVQPnI4/",
      "https://www.instagram.com/tv/BkfuX9UB-eK/",
    ]) {
      expect(normalizeInstagramUrl(url)).toBe(url);
    }
  });

  it("rejects Stories with a specific explanation (they require a logged-in account)", () => {
    try {
      normalizeInstagramUrl("https://www.instagram.com/stories/natgeo/3456789012345678901/");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
      expect((err as AppError).message).toMatch(/logged-in/);
    }
  });

  it("recognizes /share/ links as needing a redirect followed first", () => {
    expect(isInstagramShareLink("https://www.instagram.com/share/reel/BAabc123/")).toBe(true);
    expect(isInstagramShareLink("https://www.instagram.com/share/BAabc123")).toBe(true);
    expect(isInstagramShareLink("https://www.instagram.com/reel/DJQJeVQPnI4/")).toBe(false);
  });
});
