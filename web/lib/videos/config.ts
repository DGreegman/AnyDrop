import path from "path";
import fs from "fs";

function hasExecutableOnPath(cmd: string): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function resolveYtDlpPath(): string {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;

  const bundledZipapp = path.join(process.cwd(), "bin", "yt-dlp");
  const bundledStandalone = path.join(process.cwd(), "bin", "yt-dlp_linux");

  // Prefer the lightweight zipapp (~3MB, runs directly — no self-extraction)
  // wherever python3 is actually available, e.g. local dev or a self-hosted
  // deploy. It starts in ~1-2s instead of paying PyInstaller's ~80MB
  // extract-to-tmp cost on every single invocation.
  if (hasExecutableOnPath("python3") && fs.existsSync(bundledZipapp)) {
    return bundledZipapp;
  }

  // Fallback: the standalone (no python3 required) build — needed on
  // Vercel, where python3 isn't guaranteed to be on PATH. See
  // scripts/setup-resolver.sh and next.config.ts's
  // outputFileTracingIncludes, which ships this with the serverless
  // function.
  if (fs.existsSync(bundledStandalone)) return bundledStandalone;

  // Last resort: rely on a system-installed yt-dlp on PATH.
  return "yt-dlp";
}

export const config = {
  ytDlpPath: resolveYtDlpPath(),
  // Real-world network variance (DNS, X's own latency) can comfortably eat
  // 10-20s on a bad connection even with a warm process — this has enough
  // margin not to false-positive on that while still bounding a genuinely
  // hung subprocess.
  resolverTimeoutMs: parseInt(process.env.RESOLVER_TIMEOUT_MS ?? "30000", 10),
  downloadTimeoutMs: parseInt(process.env.DOWNLOAD_TIMEOUT_MS ?? "45000", 10),

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  rateLimitMaxResolve: parseInt(process.env.RATE_LIMIT_MAX ?? "20", 10),
  rateLimitMaxDownload: parseInt(process.env.RATE_LIMIT_MAX ?? "20", 10) * 2,
};
