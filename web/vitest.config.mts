import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Deterministic regardless of the machine running the suite: no
      // ffmpeg (so merged/MP3 variants only appear where a test opts in
      // with canMerge: true) and no resolve cache (route tests share one
      // module-level MediaService across cases).
      FFMPEG_PATH: "/nonexistent/anydrop-test-ffmpeg",
      RESOLVE_CACHE_TTL_MS: "0",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
