import { describe, expect, it } from "vitest";
import { getResolver } from "@/lib/media/resolver-registry";
import { XVideoResolver } from "@/lib/media/x/resolver";
import { InstagramResolver } from "@/lib/media/instagram/resolver";
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

  it("returns the same cached instance on repeated calls", () => {
    expect(getResolver("x")).toBe(getResolver("x"));
    expect(getResolver("instagram")).toBe(getResolver("instagram"));
  });

  it.each(["tiktok", "facebook"] as const)(
    "fails cleanly for a recognized-but-unimplemented platform: %s",
    (platform) => {
      try {
        getResolver(platform);
        throw new Error("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("UNSUPPORTED_URL");
        expect((err as AppError).message).not.toContain("undefined");
      }
    }
  );
});
