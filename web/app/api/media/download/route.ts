import { NextRequest } from "next/server";
import { validateMediaUrl, buildMediaResponse } from "@/lib/media/download";
import { errorResponse, AppError } from "@/lib/media/errors";
import { enforceDownloadRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Only meaningful on Vercel (a self-hosted `next start` has no such cap).
// Left at 60 because a larger value fails the deploy on plans that don't
// allow it — long merged/MP3 downloads are a reason to self-host.
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<Response> {
  try {
    enforceDownloadRateLimit(req);

    const rawUrl = req.nextUrl.searchParams.get("url");
    const quality = req.nextUrl.searchParams.get("quality") ?? undefined;
    // Suggested filename base from the client (sanitized in safeFilename).
    const name = req.nextUrl.searchParams.get("name") ?? undefined;
    const disposition = req.nextUrl.searchParams.get("mode") === "inline" ? "inline" : "attachment";

    if (!rawUrl || rawUrl.trim() === "") {
      throw new AppError("INVALID_URL", "A media url query parameter is required.");
    }

    const mediaUrl = validateMediaUrl(rawUrl);
    const range = req.headers.get("range");

    return await buildMediaResponse(mediaUrl, { quality, name, disposition, range });
  } catch (err) {
    return errorResponse(err);
  }
}
