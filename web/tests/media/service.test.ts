import { describe, expect, it } from "vitest";
import { MediaService } from "@/lib/media/service";
import { MediaResolver, ResolvedMedia } from "@/lib/media/types";
import { AppError } from "@/lib/media/errors";

function fakeResolver(impl: MediaResolver["resolve"]): MediaResolver {
  return { resolve: impl };
}

const sampleMedia: ResolvedMedia = {
  platform: "x",
  sourceUrl: "https://x.com/user/status/1",
  title: "Sample",
  duration: 10,
  media: [{ quality: "720p", format: "mp4", url: "https://video.twimg.com/a.mp4", hasAudio: true }],
};

const sampleInstagramMedia: ResolvedMedia = {
  platform: "instagram",
  sourceUrl: "https://www.instagram.com/reel/abc123/",
  title: "Sample reel",
  author: { username: "someuser" },
  media: [
    { quality: "original", format: "mp4", url: "https://x.fna.fbcdn.net/a.mp4", hasAudio: true },
  ],
};

const sampleTikTokMedia: ResolvedMedia = {
  platform: "tiktok",
  sourceUrl: "https://www.tiktok.com/@user/video/123",
  title: "Sample video",
  author: { username: "user", displayName: "User" },
  duration: 30,
  media: [
    {
      quality: "1280p",
      width: 720,
      height: 1280,
      format: "mp4",
      url: "https://www.tiktok.com/@user/video/123?xdrop_format=h264_720p-0",
      hasAudio: true,
    },
  ],
};

describe("MediaService.resolveMedia", () => {
  it("detects the platform, resolves via the matching resolver, and returns its result", async () => {
    let receivedPlatform: string | undefined;
    const service = new MediaService((platform) => {
      receivedPlatform = platform;
      return fakeResolver(async () => sampleMedia);
    });

    const result = await service.resolveMedia("https://x.com/user/status/1");
    expect(receivedPlatform).toBe("x");
    expect(result).toEqual(sampleMedia);
  });

  it("detects an Instagram URL and dispatches to the Instagram resolver", async () => {
    let receivedPlatform: string | undefined;
    const service = new MediaService((platform) => {
      receivedPlatform = platform;
      return fakeResolver(async () => sampleInstagramMedia);
    });

    const result = await service.resolveMedia("https://www.instagram.com/reel/abc123/");
    expect(receivedPlatform).toBe("instagram");
    expect(result).toEqual(sampleInstagramMedia);
  });

  it("detects a TikTok URL and dispatches to the TikTok resolver", async () => {
    let receivedPlatform: string | undefined;
    const service = new MediaService((platform) => {
      receivedPlatform = platform;
      return fakeResolver(async () => sampleTikTokMedia);
    });

    const result = await service.resolveMedia("https://www.tiktok.com/@user/video/123");
    expect(receivedPlatform).toBe("tiktok");
    expect(result).toEqual(sampleTikTokMedia);
  });

  it("detects a TikTok short link and dispatches to the TikTok resolver", async () => {
    let receivedPlatform: string | undefined;
    const service = new MediaService((platform) => {
      receivedPlatform = platform;
      return fakeResolver(async () => sampleTikTokMedia);
    });

    await service.resolveMedia("https://vm.tiktok.com/ZS4YoeRv2/");
    expect(receivedPlatform).toBe("tiktok");
  });

  it("propagates a resolver failure as-is", async () => {
    const service = new MediaService(() =>
      fakeResolver(async () => {
        throw new AppError("VIDEO_NOT_FOUND", "This post does not contain a video.");
      })
    );

    await expect(service.resolveMedia("https://x.com/user/status/1")).rejects.toMatchObject({
      code: "VIDEO_NOT_FOUND",
    });
  });

  it("rejects with VIDEO_UNAVAILABLE if the resolver returns no media variants", async () => {
    const service = new MediaService(() => fakeResolver(async () => ({ ...sampleMedia, media: [] })));

    await expect(service.resolveMedia("https://x.com/user/status/1")).rejects.toMatchObject({
      code: "VIDEO_UNAVAILABLE",
    });
  });

  it("fails with UNSUPPORTED_URL before ever calling a resolver for an unsupported domain", async () => {
    let called = false;
    const service = new MediaService(() => fakeResolver(async () => {
      called = true;
      return sampleMedia;
    }));

    await expect(service.resolveMedia("https://example.com/foo")).rejects.toMatchObject({
      code: "UNSUPPORTED_URL",
    });
    expect(called).toBe(false);
  });
});

describe("MediaService — caching, de-duplication, retry", () => {
  it("serves a repeat request for the same URL from cache", async () => {
    let calls = 0;
    const service = new MediaService(
      () => fakeResolver(async () => {
        calls++;
        return sampleMedia;
      }),
      { cacheTtlMs: 60_000 }
    );
    await service.resolveMedia("https://x.com/user/status/1");
    await service.resolveMedia("https://x.com/user/status/1");
    expect(calls).toBe(1);
  });

  it("does not cache when the TTL is 0, and never caches failures", async () => {
    let calls = 0;
    const service = new MediaService(
      () => fakeResolver(async () => {
        calls++;
        throw new AppError("VIDEO_NOT_FOUND", "nope");
      }),
      { cacheTtlMs: 60_000 }
    );
    await expect(service.resolveMedia("https://x.com/user/status/1")).rejects.toThrow("nope");
    await expect(service.resolveMedia("https://x.com/user/status/1")).rejects.toThrow("nope");
    expect(calls).toBe(2);
  });

  it("shares one resolve between concurrent requests for the same URL", async () => {
    let calls = 0;
    const service = new MediaService(
      () => fakeResolver(async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return sampleMedia;
      }),
      { cacheTtlMs: 0 }
    );
    const [a, b] = await Promise.all([
      service.resolveMedia("https://x.com/user/status/1"),
      service.resolveMedia("https://x.com/user/status/1"),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("evicts the oldest entry once the cache is full", async () => {
    let calls = 0;
    const service = new MediaService(
      () => fakeResolver(async () => {
        calls++;
        return sampleMedia;
      }),
      { cacheTtlMs: 60_000, cacheMaxEntries: 1 }
    );
    await service.resolveMedia("https://x.com/user/status/1");
    await service.resolveMedia("https://x.com/user/status/2"); // evicts /1
    await service.resolveMedia("https://x.com/user/status/1");
    expect(calls).toBe(3);
  });

  it("retries once after a transient-looking failure (VIDEO_RESOLUTION_FAILED)", async () => {
    let calls = 0;
    const service = new MediaService(
      () => fakeResolver(async () => {
        calls++;
        if (calls === 1) throw new AppError("VIDEO_RESOLUTION_FAILED", "flaky");
        return sampleMedia;
      }),
      { cacheTtlMs: 0, retryDelayMs: 1 }
    );
    await expect(service.resolveMedia("https://x.com/user/status/1")).resolves.toEqual(sampleMedia);
    expect(calls).toBe(2);
  });

  it("does not retry definitive failures (NOT_FOUND, UNAVAILABLE, TIMEOUT)", async () => {
    for (const code of ["VIDEO_NOT_FOUND", "VIDEO_UNAVAILABLE", "RESOLVER_TIMEOUT"] as const) {
      let calls = 0;
      const service = new MediaService(
        () => fakeResolver(async () => {
          calls++;
          throw new AppError(code, "x");
        }),
        { cacheTtlMs: 0, retryDelayMs: 1 }
      );
      await expect(service.resolveMedia("https://x.com/user/status/1")).rejects.toBeInstanceOf(AppError);
      expect(calls).toBe(1);
    }
  });
});
