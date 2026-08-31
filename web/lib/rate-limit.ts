import { AppError } from "./media/errors";
import { config } from "./media/config";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory fixed-window rate limiter (no Redis — see architecture
 * doc §3, "keep the MVP small"). Same caveat as any in-memory limiter on a
 * serverless platform: state is per warm function instance, not shared
 * across concurrent instances or cold starts, so it's a best-effort
 * backstop rather than a hard guarantee. Good enough for an MVP; swap for
 * Upstash/Vercel KV if this needs to be authoritative later.
 */
function createLimiter(windowMs: number, max: number) {
  const buckets = new Map<string, Bucket>();

  return function check(key: string): void {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    if (bucket.count >= max) {
      throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.");
    }

    bucket.count += 1;
  };
}

function clientKey(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  // No proxy header available (e.g. local dev) — fall back to a single
  // shared bucket rather than skipping rate limiting entirely.
  return "unknown";
}

const checkResolveLimit = createLimiter(config.rateLimitWindowMs, config.rateLimitMaxResolve);
const checkDownloadLimit = createLimiter(config.rateLimitWindowMs, config.rateLimitMaxDownload);

export function enforceResolveRateLimit(req: Request): void {
  checkResolveLimit(clientKey(req));
}

export function enforceDownloadRateLimit(req: Request): void {
  checkDownloadLimit(clientKey(req));
}
