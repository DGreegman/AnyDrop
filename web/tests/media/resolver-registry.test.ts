import { describe, expect, it } from "vitest";
import { getResolver } from "@/lib/media/resolver-registry";
import { XVideoResolver } from "@/lib/media/x/resolver";
import { InstagramResolver } from "@/lib/media/instagram/resolver";
import { TikTokResolver } from "@/lib/media/tiktok/resolver";
import { FacebookResolver } from "@/lib/media/facebook/resolver";

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
    expect(getResolver("facebook")).toBe(getResolver("facebook"));
  });

  it("resolves 'facebook' to a FacebookResolver instance", () => {
    expect(getResolver("facebook")).toBeInstanceOf(FacebookResolver);
  });
});
