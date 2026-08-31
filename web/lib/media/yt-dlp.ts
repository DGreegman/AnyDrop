import { spawn, ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import path from "path";
import fs from "fs";
import { AppError } from "./errors";

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

const bundledZipapp = path.join(process.cwd(), "bin", "yt-dlp");
const bundledStandalone = path.join(process.cwd(), "bin", "yt-dlp_linux");

function resolveYtDlpPath(preferZipapp: boolean): string {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;

  // Prefer the lightweight zipapp (~3MB, runs directly — no self-extraction)
  // wherever python3 is actually available, e.g. local dev or a self-hosted
  // deploy. It starts in ~1-2s instead of paying PyInstaller's ~80MB
  // extract-to-tmp cost on every single invocation.
  if (preferZipapp && hasExecutableOnPath("python3") && fs.existsSync(bundledZipapp)) {
    return bundledZipapp;
  }

  // Fallback: the standalone (no python3 required) build — needed on
  // Vercel, where python3 isn't guaranteed to be on PATH. See
  // scripts/setup-resolver.sh and next.config.ts's
  // outputFileTracingIncludes, which ships this with the serverless
  // function.
  if (fs.existsSync(bundledStandalone)) return bundledStandalone;
  if (fs.existsSync(bundledZipapp)) return bundledZipapp;

  // Last resort: rely on a system-installed yt-dlp on PATH.
  return "yt-dlp";
}

/**
 * yt-dlp is a single shared tool that happens to have extractors for many
 * sites — it's not "the X resolver," it's a resource every yt-dlp-backed
 * platform resolver (X, Instagram, TikTok, ...) spawns the same way. This
 * is that one shared place, so adding a platform doesn't mean re-copying
 * subprocess/timeout/kill handling.
 */
export const ytDlpPath = resolveYtDlpPath(true);

/**
 * TikTok specifically must use this, not the auto-selected ytDlpPath
 * above. Found empirically, not assumed: TikTok's extractor does a
 * "Solving JS challenge using native Python implementation" step, and
 * that step was reproduced failing *consistently and deterministically*
 * when run via the zipapp (which shells out to whatever `python3` happens
 * to be on PATH) while succeeding reliably via the standalone build
 * (which bundles its own Python) — same machine, same video, tested
 * back-to-back, repeatedly. X and Instagram show no such difference
 * between the two binaries.
 */
export const ytDlpStandalonePath = resolveYtDlpPath(false);

// Real-world network variance (DNS, the target site's own latency) can
// comfortably eat 10-20s on a bad connection even with a warm process —
// this has enough margin not to false-positive on that while still
// bounding a genuinely hung subprocess.
export const resolverTimeoutMs = parseInt(process.env.RESOLVER_TIMEOUT_MS ?? "30000", 10);

/**
 * Spawns yt-dlp with the given arguments and wires up the same
 * timeout -> SIGTERM -> (grace period) -> SIGKILL safety every caller
 * needs, without dictating how the caller consumes stdout — runYtDlp
 * below buffers it (for --dump-json); tiktok/download.ts streams it
 * live instead (piping a real download straight to the HTTP response).
 *
 * SIGTERM first, not SIGKILL: the standalone (PyInstaller) yt-dlp binary
 * self-extracts to a ~80MB temp directory on start and only cleans it up
 * on a normal exit. SIGKILL skips that entirely and leaks the extraction
 * dir on every single timeout — under any real disk/memory pressure that
 * compounds into every subsequent extraction getting slower, causing more
 * timeouts. Escalate to SIGKILL only if it doesn't exit on its own shortly.
 */
export function spawnYtDlp(
  args: string[],
  timeoutMs: number = resolverTimeoutMs,
  binaryPath: string = ytDlpPath
): { child: ChildProcessByStdio<null, Readable, Readable>; timedOut: () => boolean } {
  // binaryPath is resolved via fs checks (ytDlpPath/ytDlpStandalonePath
  // above), so Turbopack's static analyzer can't prove which file this
  // touches and defaults to tracing (and bundling) the entire project —
  // next.config.ts's outputFileTracingIncludes already declares exactly
  // the files that are actually needed (./bin/**), so that fallback is
  // redundant here.
  const child = spawn(/* turbopackIgnore: true */ binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    child.kill("SIGTERM");
    const forceKill = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("close", () => clearTimeout(forceKill));
  }, timeoutMs);
  child.once("close", () => clearTimeout(timer));

  return { child, timedOut: () => didTimeOut };
}

export interface YtDlpRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Runs yt-dlp against a URL with --dump-json and returns its raw
 * stdout/stderr/exit code — no site-specific interpretation here, that's
 * each platform resolver's own job (see x/resolver.ts, instagram/resolver.ts,
 * tiktok/resolver.ts).
 */
export function runYtDlp(
  url: string,
  timeoutMs: number = resolverTimeoutMs,
  binaryPath: string = ytDlpPath
): Promise<YtDlpRunResult> {
  return new Promise((resolve, reject) => {
    // Argument array only — never build a shell string from user input.
    const args = [
      url,
      "--dump-json",
      "--no-warnings",
      "--no-playlist",
      "--no-progress",
      "--socket-timeout",
      "15",
    ];

    const { child, timedOut } = spawnYtDlp(args, timeoutMs, binaryPath);

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(
        new AppError("VIDEO_RESOLUTION_FAILED", "The video resolver is unavailable.", {
          cause: err,
        })
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timedOut()) {
        reject(new AppError("RESOLVER_TIMEOUT", "Timed out while resolving the video."));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}
