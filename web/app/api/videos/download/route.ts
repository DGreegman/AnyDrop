/**
 * @deprecated Superseded by GET /api/media/download. The download proxy
 * was already platform-agnostic in shape (it just streams a validated
 * media URL), so there's no legacy response shape to adapt here, unlike
 * /api/videos/resolve — the handler itself is simply re-exported.
 * `runtime`/`maxDuration` have to be declared literally in this file too:
 * Next statically parses route segment config per-file at build time, so
 * re-exporting them from another module isn't recognized. Kept only for
 * backward compatibility during the migration — new code should call
 * /api/media/download directly.
 */
export { GET } from "@/app/api/media/download/route";

export const runtime = "nodejs";
export const maxDuration = 60;
