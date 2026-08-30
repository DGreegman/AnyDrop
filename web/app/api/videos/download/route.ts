import { NextRequest } from "next/server";
import { validateMediaUrl, buildMediaResponse } from "@/lib/videos/download";
import { errorResponse, AppError } from "@/lib/videos/errors";
import { enforceDownloadRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<Response> {
  try {
    enforceDownloadRateLimit(req);

    const rawUrl = req.nextUrl.searchParams.get("url");
    const quality = req.nextUrl.searchParams.get("quality") ?? undefined;
    const disposition = req.nextUrl.searchParams.get("mode") === "inline" ? "inline" : "attachment";

    if (!rawUrl || rawUrl.trim() === "") {
      throw new AppError("INVALID_URL", "A media url query parameter is required.");
    }

    const mediaUrl = validateMediaUrl(rawUrl);
    const range = req.headers.get("range");

    return await buildMediaResponse(mediaUrl, { quality, disposition, range });
  } catch (err) {
    return errorResponse(err);
  }
}
