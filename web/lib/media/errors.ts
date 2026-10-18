export type ErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_URL"
  | "VIDEO_NOT_FOUND"
  | "VIDEO_UNAVAILABLE"
  | "VIDEO_RESOLUTION_FAILED"
  | "RESOLVER_TIMEOUT"
  | "DOWNLOAD_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  UNSUPPORTED_URL: 400,
  VIDEO_NOT_FOUND: 404,
  VIDEO_UNAVAILABLE: 404,
  VIDEO_RESOLUTION_FAILED: 502,
  RESOLVER_TIMEOUT: 504,
  DOWNLOAD_FAILED: 502,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Application-level error carrying a stable error code and safe-to-expose
 * message. Never put stack traces, file paths, or resolver internals here —
 * that's what `cause` / server-side logging is for.
 *
 * The VIDEO_* codes predate the media-platform generalization (AnyDrop
 * started X-only) but stay as-is on purpose: they're specific,
 * well-understood failure conditions from the yt-dlp-backed resolver, and
 * renaming them would be churn for no behavioral benefit — see
 * lib/media/x/resolver.ts's classifyResolverFailure.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (options?.cause) this.cause = options.cause;
  }
}

/**
 * Builds the API's consistent {success:false, error:{code,message}} JSON
 * response from any thrown value. AppErrors map to their own status/code;
 * anything else (a bug, a rejected promise from a dependency) becomes a
 * safe, generic 500 — its real detail goes to server logs only.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      console.error(`[${err.code}]`, err.message, err.cause ?? "");
    }
    return Response.json(
      { success: false, error: { code: err.code, message: err.message } },
      { status: err.status }
    );
  }

  console.error("[UNHANDLED_ERROR]", err);
  return Response.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    },
    { status: 500 }
  );
}
