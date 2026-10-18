import { describe, expect, it } from "vitest";
import { MediaService } from "@/lib/media/service";
import { buildMediaResponse, validateMediaUrl } from "@/lib/media/download";
import type { ResolvedMedia } from "@/lib/media/types";

/**
 * One known-good public post per platform. If one of these starts
 * failing, either the post was deleted (swap in another public one) or
 * the platform changed something and yt-dlp needs updating
 * (`npm run update-resolver`) — the error message says which.
 *
 * CI runners use datacenter IPs, which Instagram in particular throttles
 * harder than home connections; an Instagram-only failure in CI that
 * passes locally points at that, not at a code bug.
 */
const SAMPLES: Array<{ platform: ResolvedMedia["platform"]; url: string; minItems?: number }> = [
  // Two videos in one tweet — also covers multi-item extraction.
  { platform: "x", url: "https://x.com/primevideouk/status/1578401165338976258", minItems: 2 },
  { platform: "instagram", url: "https://www.instagram.com/p/DJQJeVQPnI4/" },
  { platform: "tiktok", url: "https://www.tiktok.com/@natgeo/video/7595589117723954487" },
  { platform: "facebook", url: "https://www.facebook.com/watch/?v=647537299265662" },
];

const service = new MediaService();

describe.each(SAMPLES)("$platform", ({ platform, url, minItems }) => {
  it("resolves a real public post to downloadable media", async () => {
    const result = await service.resolveMedia(url);
    expect(result.platform).toBe(platform);
    expect(result.media.some((v) => v.kind !== "audio")).toBe(true);
    if (minItems) expect(result.items?.length ?? 1).toBeGreaterThanOrEqual(minItems);

    // ...and the first plain video variant actually starts streaming.
    const file = result.media.find((v) => (v.kind ?? "file") === "file");
    expect(file).toBeDefined();
    const res = await buildMediaResponse(validateMediaUrl(file!.url), {
      disposition: "attachment",
      range: "bytes=0-1023",
    });
    expect(res.ok).toBe(true);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength ?? 0).toBeGreaterThan(0);
    await reader.cancel();
  });
});
