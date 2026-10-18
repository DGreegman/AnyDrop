import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Live checks against real public posts — real yt-dlp, real network.
 * Not part of `npm test` (slow, and depends on the outside world); run
 * with `npm run test:live`, and daily in CI (.github/workflows/live-check.yml)
 * so a platform change that breaks extraction is noticed before users
 * notice it.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests-live/**/*.live.test.ts"],
    testTimeout: 120_000,
    // One platform at a time — parallel runs make rate limiting more likely.
    fileParallelism: false,
    env: { RESOLVE_CACHE_TTL_MS: "0" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
