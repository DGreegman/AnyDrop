import { z } from "zod";
import { AppError } from "./errors";
import { extractMediaUrl } from "./platforms";

const resolveBodySchema = z.object({
  // Share sheets hand over text like "Check out this video! https://…",
  // not a bare URL, and that text arrives here verbatim (see
  // extractMediaUrl below) — so the limit is generous, but bounded.
  url: z.string({ required_error: "url is required" }).trim().min(1, "url is required").max(4000),
});

/**
 * HTTP-layer validation: confirms the request body has a non-empty `url`
 * string, then pulls the actual link out of it if it came wrapped in
 * other text (share-sheet text, a pasted sentence — see
 * platforms.ts#extractMediaUrl). Platform identification and
 * platform-specific URL shape checks (e.g. X requiring
 * /<user>/status/<id>) happen further down — see platform-detector.ts
 * and each platform's own resolver.
 */
export function validateResolveRequest(body: unknown): { url: string } {
  const parsed = resolveBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_URL", "A valid post URL is required.");
  }
  const raw = parsed.data.url;
  return { url: extractMediaUrl(raw) ?? raw };
}
