import { AppError } from "./errors";
import { MediaResolver, Platform, ResolvedMedia } from "./types";
import { detectPlatform } from "./platform-detector";
import { getResolver } from "./resolver-registry";
import { config } from "./config";

// One retry, for failures that look transient. Only the catch-all
// VIDEO_RESOLUTION_FAILED qualifies: it's what an unrecognized yt-dlp
// error maps to — notably TikTok's anti-bot throttling ("Unexpected
// response from webpage request"), which was seen failing once and then
// succeeding on an immediate retry. NOT_FOUND/UNAVAILABLE are definitive,
// and a TIMEOUT already used the whole time budget.
const RETRY_DELAY_MS = 750;

interface CacheEntry {
  value: ResolvedMedia;
  expiresAt: number;
}

export interface MediaServiceOptions {
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  retryDelayMs?: number;
}

/**
 * Top-level orchestration: detect which platform a URL belongs to, hand
 * off to that platform's resolver, and return the normalized result.
 * Deliberately knows nothing about yt-dlp, subprocess handling, or any
 * platform-specific extraction detail — that all lives behind the
 * MediaResolver interface each platform implements.
 *
 * On top of that it adds three things every platform benefits from:
 *   - a short-lived in-memory cache of successful results (pasting the
 *     same link twice, or re-opening it from "Recent", is instant),
 *   - in-flight de-duplication (two simultaneous requests for the same
 *     link share one yt-dlp run instead of starting two),
 *   - one retry for transient-looking failures (see RETRY_DELAY_MS).
 * In-memory is the right size for a single long-running server (a VPS);
 * on serverless it's simply per-instance and best-effort.
 *
 * `resolveForPlatform` defaults to the real resolver-registry lookup;
 * tests can inject a fake to exercise the orchestration flow without a
 * real resolver (yt-dlp, network, etc) in the loop.
 */
export class MediaService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ResolvedMedia>>();
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly resolveForPlatform: (platform: Platform) => MediaResolver = getResolver,
    options: MediaServiceOptions = {}
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? config.resolveCacheTtlMs;
    this.cacheMaxEntries = options.cacheMaxEntries ?? config.resolveCacheMaxEntries;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  }

  async resolveMedia(url: string): Promise<ResolvedMedia> {
    // detectPlatform both validates that `url` is well-formed http(s) and
    // identifies which platform it belongs to — see platform-detector.ts.
    const platform = detectPlatform(url);
    const key = url.trim();

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.cache.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const work = this.resolveWithRetry(platform, url).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);

    const resolved = await work;
    this.remember(key, resolved);
    return resolved;
  }

  private async resolveWithRetry(platform: Platform, url: string): Promise<ResolvedMedia> {
    const resolver = this.resolveForPlatform(platform);
    try {
      return this.check(await resolver.resolve(url));
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== "VIDEO_RESOLUTION_FAILED") throw err;
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
      return this.check(await resolver.resolve(url));
    }
  }

  private check(resolved: ResolvedMedia): ResolvedMedia {
    if (!resolved.media || resolved.media.length === 0) {
      throw new AppError("VIDEO_UNAVAILABLE", "No downloadable media variants were found.");
    }
    return resolved;
  }

  private remember(key: string, value: ResolvedMedia): void {
    if (this.cacheTtlMs <= 0 || this.cacheMaxEntries <= 0) return;
    // Map iteration order is insertion order, so the first key is the
    // oldest — evict it once full.
    while (this.cache.size >= this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
  }
}
