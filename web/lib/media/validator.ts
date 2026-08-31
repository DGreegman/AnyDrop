import { z } from "zod";
import { AppError } from "./errors";

const resolveBodySchema = z.object({
  url: z.string({ required_error: "url is required" }).trim().min(1, "url is required"),
});

/**
 * HTTP-layer validation only: confirms the request body has a non-empty
 * `url` string. Platform identification and platform-specific URL shape
 * checks (e.g. X requiring /<user>/status/<id>) happen further down —
 * see platform-detector.ts and each platform's own resolver.
 */
export function validateResolveRequest(body: unknown): { url: string } {
  const parsed = resolveBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_URL", "A valid post URL is required.");
  }
  return { url: parsed.data.url };
}
