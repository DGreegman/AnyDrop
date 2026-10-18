import { NextRequest } from "next/server";
import { MediaService } from "@/lib/media/service";
import { validateResolveRequest } from "@/lib/media/validator";
import { errorResponse } from "@/lib/media/errors";
import { enforceResolveRateLimit } from "@/lib/rate-limit";
import type { ResolvedMedia } from "@/lib/media/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const mediaService = new MediaService();

/**
 * Legacy X-only shape this endpoint returned before the media-platform
 * generalization (see lib/media/). Kept identical so external consumers
 * of the old contract don't need to change (AnyDrop's own frontend uses
 * /api/media/resolve): this is the same MediaService, MEDIA -> VIDEO
 * renamed on the way out. Only the first video of a multi-video post is
 * included — the old shape has no way to express more.
 */
function toLegacyVideoShape(media: ResolvedMedia) {
  return {
    sourceUrl: media.sourceUrl,
    thumbnail: media.thumbnail,
    title: media.title,
    duration: media.duration,
    videos: media.media.map((v) => ({
      quality: v.quality,
      width: v.width,
      height: v.height,
      bitrate: v.bitrate,
      format: v.format,
      url: v.url,
    })),
  };
}

/**
 * @deprecated Superseded by POST /api/media/resolve, which returns the
 * full ResolvedMedia shape (platform, author, hasAudio per variant, etc)
 * and works the same way for every supported platform, not just X. This
 * route is kept only for backward compatibility during the migration —
 * new code should call /api/media/resolve directly.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    enforceResolveRateLimit(req);

    const body = await req.json().catch(() => null);
    const { url } = validateResolveRequest(body);
    const data = await mediaService.resolveMedia(url);

    return Response.json({ success: true, data: toLegacyVideoShape(data) });
  } catch (err) {
    return errorResponse(err);
  }
}
