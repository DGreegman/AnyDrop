import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/videos/errors";
import type { ResolvedVideo } from "@/lib/videos/types";

const resolveMock = vi.fn();

vi.mock("@/lib/videos/resolver", () => ({
  XVideoResolver: vi.fn().mockImplementation(function XVideoResolverMock(this: {
    resolve: typeof resolveMock;
  }) {
    this.resolve = resolveMock;
  }),
}));

const { POST } = await import("@/app/api/videos/resolve/route");

const sampleVideo: ResolvedVideo = {
  sourceUrl: "https://x.com/user/status/123456789",
  thumbnail: "https://pbs.twimg.com/thumb.jpg",
  title: "Sample",
  duration: 10,
  videos: [{ quality: "720p", width: 1280, height: 720, format: "mp4", url: "https://video.twimg.com/a.mp4" }],
};

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/videos/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveMock.mockReset();
});

describe("POST /api/videos/resolve", () => {
  it("returns normalized video data for a valid X URL", async () => {
    resolveMock.mockResolvedValue(sampleVideo);

    const res = await POST(postRequest({ url: "https://x.com/user/status/123456789" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(sampleVideo);
    expect(body.data).not.toHaveProperty("formats");
    expect(body.data).not.toHaveProperty("extractor");
  });

  it("returns 400 INVALID_URL for a missing url, without ever calling the resolver", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: "INVALID_URL", message: expect.any(String) },
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_URL for a malformed url", async () => {
    const res = await POST(postRequest({ url: "not-a-url" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("returns 400 UNSUPPORTED_URL for a non-X domain", async () => {
    const res = await POST(postRequest({ url: "https://example.com/user/status/123456789" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });

  it("maps a resolver failure to its HTTP status without leaking internals", async () => {
    resolveMock.mockRejectedValue(new AppError("VIDEO_NOT_FOUND", "This post does not contain a video."));

    const res = await POST(postRequest({ url: "https://x.com/user/status/123456789" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: "VIDEO_NOT_FOUND", message: "This post does not contain a video." },
    });
  });

  it("maps an unexpected resolver crash to a safe 500 INTERNAL_ERROR", async () => {
    resolveMock.mockRejectedValue(new Error("some internal detail like a file path or stack trace"));

    const res = await POST(postRequest({ url: "https://x.com/user/status/123456789" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });
});
