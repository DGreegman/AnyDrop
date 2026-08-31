import { NextRequest } from "next/server";
import { MediaService } from "@/lib/media/service";
import { validateResolveRequest } from "@/lib/media/validator";
import { errorResponse } from "@/lib/media/errors";
import { enforceResolveRateLimit } from "@/lib/rate-limit";

// Needs Node's child_process (spawns the bundled yt-dlp binary) — not
// available in the Edge runtime.
export const runtime = "nodejs";
// Resolution usually takes a few seconds; give it real headroom on
// platforms (Vercel Pro+) that honor a larger value than the default.
export const maxDuration = 60;

const mediaService = new MediaService();

export async function POST(req: NextRequest): Promise<Response> {
  try {
    enforceResolveRateLimit(req);

    const body = await req.json().catch(() => null);
    const { url } = validateResolveRequest(body);
    const data = await mediaService.resolveMedia(url);

    return Response.json({ success: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
