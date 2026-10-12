/**
 * App-wide config shared across all platforms/resolvers (rate limiting,
 * the streaming-download proxy). yt-dlp's own config (binary path,
 * resolver timeout) lives in yt-dlp.ts — it's a shared tool, not
 * platform-specific.
 */
export const config = {
  downloadTimeoutMs: parseInt(process.env.DOWNLOAD_TIMEOUT_MS ?? "45000", 10),

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  rateLimitMaxResolve: parseInt(process.env.RATE_LIMIT_MAX ?? "20", 10),
  rateLimitMaxDownload: parseInt(process.env.RATE_LIMIT_MAX ?? "20", 10) * 2,

  // Successful resolves are reused for this long (0 disables). Short on
  // purpose: Instagram/Facebook CDN URLs are signed and expire, and a
  // post can be edited or deleted.
  resolveCacheTtlMs: parseInt(process.env.RESOLVE_CACHE_TTL_MS ?? "300000", 10),
  resolveCacheMaxEntries: parseInt(process.env.RESOLVE_CACHE_MAX ?? "200", 10),
};
