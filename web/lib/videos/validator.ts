import { z } from "zod";
import { AppError } from "./errors";

const ALLOWED_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
]);

// e.g. /someuser/status/1234567890123456789
const STATUS_PATH_RE = /^\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d+)(?:\/.*)?$/;

const resolveBodySchema = z.object({
  url: z.string({ required_error: "url is required" }).trim().min(1, "url is required"),
});

/**
 * Validates that the request contains a well-formed URL pointing at a
 * public X/Twitter status. Throws AppError with a precise code so the
 * route handler / error responder can map it to the right HTTP response.
 */
export function validateResolveRequest(body: unknown): { url: string } {
  const parsed = resolveBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_URL", "A valid X/Twitter post URL is required.");
  }

  const raw = parsed.data.url;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(raw);
  } catch {
    throw new AppError("INVALID_URL", "The provided value is not a valid URL.");
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new AppError("INVALID_URL", "Only http(s) URLs are supported.");
  }

  if (!ALLOWED_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "Only x.com / twitter.com post URLs are supported."
    );
  }

  if (!STATUS_PATH_RE.test(parsedUrl.pathname)) {
    throw new AppError(
      "UNSUPPORTED_URL",
      "The URL does not look like a post (expected /<user>/status/<id>)."
    );
  }

  // Normalize to https://x.com/<user>/status/<id> so the resolver always
  // sees a canonical form.
  const match = parsedUrl.pathname.match(STATUS_PATH_RE)!;
  const user = parsedUrl.pathname.split("/")[1];
  const statusId = match[1];
  const normalized = `https://x.com/${user}/status/${statusId}`;

  return { url: normalized };
}
