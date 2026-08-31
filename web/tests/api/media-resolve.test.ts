import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/media/errors";
import type { ResolvedMedia } from "@/lib/media/types";

const resolveMock = vi.fn();

vi.mock("@/lib/media/x/resolver", () => ({
  XVideoResolver: vi.fn().mockImplementation(function XVideoResolverMock(this: {
    resolve: typeof resolveMock;
  }) {
    this.resolve = resolveMock;
  }),
}));

const { POST: mediaResolvePOST } = await import("@/app/api/media/resolve/route");
const { POST: legacyVideosResolvePOST } = await import("@/app/api/videos/resolve/route");

const sampleMedia: ResolvedMedia = {
  platform: "x",
  sourceUrl: "https://x.com/user/status/123456789",
  thumbnail: "https://pbs.twimg.com/thumb.jpg",
  title: "Sample",
  author: { username: "user" },
  duration: 10,
  media: [
    {
      quality: "720p",
      width: 1280,
      height: 720,
      format: "mp4",
      url: "https://video.twimg.com/a.mp4",
      hasAudio: true,
    },
  ],
};

function postRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveMock.mockReset();
});

describe("POST /api/media/resolve", () => {
  it("returns the full normalized ResolvedMedia for a valid X URL", async () => {
    resolveMock.mockResolvedValue(sampleMedia);

    const res = await mediaResolvePOST(
      postRequest("/api/media/resolve", { url: "https://x.com/user/status/123456789" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(sampleMedia);
    expect(body.data).not.toHaveProperty("formats");
    expect(body.data).not.toHaveProperty("extractor");
  });

  it("returns 400 INVALID_URL for a missing url, without ever calling a resolver", async () => {
    const res = await mediaResolvePOST(postRequest("/api/media/resolve", {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: "INVALID_URL", message: expect.any(String) },
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_URL for a malformed url", async () => {
    const res = await mediaResolvePOST(postRequest("/api/media/resolve", { url: "not-a-url" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("returns 400 UNSUPPORTED_URL for a recognized-but-unimplemented platform (TikTok)", async () => {
    const res = await mediaResolvePOST(
      postRequest("/api/media/resolve", { url: "https://www.tiktok.com/@user/video/123" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("returns 400 UNSUPPORTED_URL for a completely unrecognized domain", async () => {
    const res = await mediaResolvePOST(
      postRequest("/api/media/resolve", { url: "https://example.com/user/status/123456789" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });

  it("maps a resolver failure to its HTTP status without leaking internals", async () => {
    resolveMock.mockRejectedValue(new AppError("VIDEO_NOT_FOUND", "This post does not contain a video."));

    const res = await mediaResolvePOST(
      postRequest("/api/media/resolve", { url: "https://x.com/user/status/123456789" })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: "VIDEO_NOT_FOUND", message: "This post does not contain a video." },
    });
  });

  it("maps an unexpected resolver crash to a safe 500 INTERNAL_ERROR", async () => {
    resolveMock.mockRejectedValue(new Error("some internal detail like a file path or stack trace"));

    const res = await mediaResolvePOST(
      postRequest("/api/media/resolve", { url: "https://x.com/user/status/123456789" })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });
});

describe("POST /api/videos/resolve (legacy, backward-compatible)", () => {
  it("still returns the old {videos: [...]} shape, not the new {media: [...]} one", async () => {
    resolveMock.mockResolvedValue(sampleMedia);

    const res = await legacyVideosResolvePOST(
      postRequest("/api/videos/resolve", { url: "https://x.com/user/status/123456789" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        sourceUrl: sampleMedia.sourceUrl,
        thumbnail: sampleMedia.thumbnail,
        title: sampleMedia.title,
        duration: sampleMedia.duration,
        videos: [
          {
            quality: "720p",
            width: 1280,
            height: 720,
            format: "mp4",
            url: "https://video.twimg.com/a.mp4",
            // no bitrate on the sample fixture -> stays undefined, dropped by JSON
          },
        ],
      },
    });
    // The new generic fields must not leak into the legacy shape.
    expect(body.data).not.toHaveProperty("platform");
    expect(body.data).not.toHaveProperty("author");
    expect(body.data).not.toHaveProperty("media");
    expect(body.data.videos[0]).not.toHaveProperty("hasAudio");
  });

  it("still returns 400 UNSUPPORTED_URL for a non-X domain", async () => {
    const res = await legacyVideosResolvePOST(
      postRequest("/api/videos/resolve", { url: "https://example.com/user/status/123456789" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });
});
