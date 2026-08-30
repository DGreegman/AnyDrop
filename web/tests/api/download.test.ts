import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/videos/download/route";

describe("GET /api/videos/download", () => {
  it("rejects a media host outside the X CDN allowlist (SSRF guard)", async () => {
    const url =
      "http://localhost/api/videos/download?url=" + encodeURIComponent("https://example.com/internal");
    const res = await GET(new NextRequest(url));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUPPORTED_URL");
  });

  it("returns 400 when the url query parameter is missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/videos/download"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("rejects a non-https media url", async () => {
    const url =
      "http://localhost/api/videos/download?url=" +
      encodeURIComponent("http://video.twimg.com/insecure.mp4");
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_URL");
  });
});
