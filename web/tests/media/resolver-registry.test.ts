import { describe, expect, it } from "vitest";
import { getResolver } from "@/lib/media/resolver-registry";
import { XVideoResolver } from "@/lib/media/x/resolver";
import { InstagramResolver } from "@/lib/media/instagram/resolver";
import { TikTokResolver } from "@/lib/media/tiktok/resolver";
import { AppError } from "@/lib/media/errors";

describe("getResolver", () => {
  it("resolves 'x' to an XVideoResolver instance", () => {
    const resolver = getResolver("x");
    expect(resolver).toBeInstanceOf(XVideoResolver);
  });

  it("resolves 'instagram' to an InstagramResolver instance", () => {
    const resolver = getResolver("instagram");
    expect(resolver).toBeInstanceOf(InstagramResolver);
  });

  it("resolves 'tiktok' to a TikTokResolver instance", () => {
    const resolver = getResolver("tiktok");
    expect(resolver).toBeInstanceOf(TikTokResolver);
  });

  it("returns the same cached instance on repeated calls", () => {
    expect(getResolver("x")).toBe(getResolver("x"));
    expect(getResolver("instagram")).toBe(getResolver("instagram"));
    expect(getResolver("tiktok")).toBe(getResolver("tiktok"));
  });

  it("fails cleanly for a recognized-but-unimplemented platform: facebook", () => {
    try {
      getResolver("facebook");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("UNSUPPORTED_URL");
      expect((err as AppError).message).not.toContain("undefined");
    }
  });
});
