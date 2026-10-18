import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as mediaDownloadGET } from "@/app/api/media/download/route";
import { GET as legacyVideosDownloadGET } from "@/app/api/videos/download/route";

describe.each([
  ["GET /api/media/download", mediaDownloadGET, "/api/media/download"],
  ["GET /api/videos/download (legacy, re-exported)", legacyVideosDownloadGET, "/api/videos/download"],
])("%s", (_name, handler, path) => {
  it("rejects a media host outside the CDN allowlist (SSRF guard)", async () => {
    const url = `http://localhost${path}?url=` + encodeURIComponent("https://example.com/internal");
    const res = await handler(new NextRequest(url));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });

  it("accepts an Instagram CDN (fbcdn.net) host — validation passes, so the failure is a real fetch error, not a host rejection", async () => {
    // A syntactically-valid but non-resolving fbcdn.net subdomain: proves
    // validateMediaUrl() accepted the host (no UNSUPPORTED_URL) without
    // depending on a real, ever-changing signed Instagram CDN URL.
    const url =
      `http://localhost${path}?url=` +
      encodeURIComponent("https://this-host-does-not-exist-anydrop-test.fna.fbcdn.net/video.mp4");
    const res = await handler(new NextRequest(url));

    expect(res.status).not.toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("DOWNLOAD_FAILED");
  });

  it("rejects a tiktok.com URL missing the anydrop_format passthrough param", async () => {
    // A bare tiktok.com video URL is not itself a fetchable media file —
    // it must carry the format selector this app's own resolver attaches.
    const url =
      `http://localhost${path}?url=` +
      encodeURIComponent("https://www.tiktok.com/@natgeo/video/7595589117723954487");
    const res = await handler(new NextRequest(url));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });

  it("rejects a tiktok.com passthrough URL with an unsafe format_id", async () => {
    const url =
      `http://localhost${path}?url=` +
      encodeURIComponent(
        "https://www.tiktok.com/@natgeo/video/7595589117723954487?anydrop_format=-rm%20-rf"
      );
    const res = await handler(new NextRequest(url));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });

  it("accepts a well-formed TikTok passthrough URL — validation passes, so a made-up format_id against a real video fails downstream, not as a host/shape rejection", async () => {
    const url =
      `http://localhost${path}?url=` +
      encodeURIComponent(
        "https://www.tiktok.com/@natgeo/video/7595589117723954487?anydrop_format=anydrop-test-nonexistent-format"
      );
    const res = await handler(new NextRequest(url));

    expect(res.status).not.toBe(400);
  }, 30000);

  it("returns 400 when the url query parameter is missing", async () => {
    const res = await handler(new NextRequest(`http://localhost${path}`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("rejects a non-https media url", async () => {
    const url =
      `http://localhost${path}?url=` + encodeURIComponent("http://video.twimg.com/insecure.mp4");
    const res = await handler(new NextRequest(url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_URL");
  });
});

describe("route re-export wiring", () => {
  it("the legacy /api/videos/download route really is the same function as /api/media/download", () => {
    expect(legacyVideosDownloadGET).toBe(mediaDownloadGET);
  });
});
