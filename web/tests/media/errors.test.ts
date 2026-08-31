import { describe, expect, it } from "vitest";
import { AppError, errorResponse } from "@/lib/media/errors";

describe("errorResponse", () => {
  it("maps an AppError to its status and a stable {success,error} body", async () => {
    const res = errorResponse(new AppError("VIDEO_NOT_FOUND", "This post does not contain a video."));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: "VIDEO_NOT_FOUND", message: "This post does not contain a video." },
    });
  });

  it("maps an unexpected thrown value to a safe 500 without leaking its detail", async () => {
    const res = errorResponse(new Error("some internal detail like a file path or stack trace"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });
});
