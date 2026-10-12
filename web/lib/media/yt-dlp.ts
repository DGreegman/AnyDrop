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
): {
  child: ChildProcessByStdio<null, Readable, Readable>;
  timedOut: () => boolean;
  /**
   * Restarts the timeout window. Streaming callers call this on every
   * chunk, turning the timeout into an *inactivity* timeout — a long
   * video that's actively downloading is never cut off part-way, only a
   * stalled one is.
   */
  resetTimer: () => void;
  /** Signals yt-dlp *and* everything it spawned (see killTree below). */
  kill: (signal?: NodeJS.Signals) => void;
} {
  // binaryPath is resolved via fs checks (ytDlpPath/ytDlpStandalonePath
  // above), so Turbopack's static analyzer can't prove which file this
  // touches and defaults to tracing (and bundling) the entire project —
  // next.config.ts's outputFileTracingIncludes already declares exactly
  // the files that are actually needed (./bin/**), so that fallback is
  // redundant here.
  //
  // detached: yt-dlp gets its own process group, so the whole tree can be
  // signalled at once. When merging/converting, yt-dlp runs ffmpeg as a
  // child that writes straight into our pipe — verified: SIGTERM to
  // yt-dlp alone left that ffmpeg running (blocked on the pipe) after a
  // cancelled download. Killing the group takes both down.
  const child = spawn(/* turbopackIgnore: true */ binaryPath, [...args, ...proxyArgs()], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const kill = (signal: NodeJS.Signals = "SIGTERM") => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // Group already gone — fall back to the direct child, ignore if
      // that's gone too.
      try {
        child.kill(signal);
      } catch {
        // nothing left to kill
      }
    }
  };

  let didTimeOut = false;
  let exited = false;
  const onTimeout = () => {
    didTimeOut = true;
    kill("SIGTERM");
    const forceKill = setTimeout(() => kill("SIGKILL"), 3000);
    child.once("close", () => clearTimeout(forceKill));
  };
  let timer = setTimeout(onTimeout, timeoutMs);
  child.once("close", () => {
    exited = true;
    clearTimeout(timer);
  });

  const resetTimer = () => {
    if (exited || didTimeOut) return;
    clearTimeout(timer);
    timer = setTimeout(onTimeout, timeoutMs);
  };

  return { child, timedOut: () => didTimeOut, resetTimer, kill };
}

/**
 * Optional outbound proxy for every yt-dlp request (YT_DLP_PROXY, e.g.
 * "http://user:pass@host:port" or "socks5://host:port"). The platforms
 * throttle or block anonymous requests from datacenter IP ranges far more
 * than from residential ones, so routing yt-dlp through a proxy is the
 * main lever when resolves work locally but fail on a server. Unset by
 * default — nothing changes unless it's configured.
 */
function proxyArgs(): string[] {
  const proxy = process.env.YT_DLP_PROXY?.trim();
  return proxy ? ["--proxy", proxy] : [];
}

/**
 * Parses yt-dlp's --dump-json stdout: one JSON object per line (several
 * lines for a multi-video post). Lines that aren't JSON are skipped
 * rather than failing the whole parse.
 */
export function parseYtDlpJsonLines<T>(stdout: string): T[] {
  const out: T[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // ignore a malformed line — the caller decides if zero is an error
    }
  }
  return out;
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
  binaryPath: string = ytDlpPath,
  options: { allowPlaylist?: boolean } = {}
): Promise<YtDlpRunResult> {
  return new Promise((resolve, reject) => {
    // Argument array only — never build a shell string from user input.
    //
    // allowPlaylist: a post with several videos (an X tweet with up to
    // four, an Instagram carousel) comes back from yt-dlp as one JSON
    // object per line, one per video — verified against a real two-video
    // tweet. --no-playlist would silently keep only the first. Capped so
    // a pathological post can't fan out into dozens of entries.
    const args = [
      url,
      "--dump-json",
      "--no-warnings",
      ...(options.allowPlaylist ? ["--yes-playlist", "--playlist-items", "1:20"] : ["--no-playlist"]),
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
