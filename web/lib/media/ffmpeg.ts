import path from "path";
import fs from "fs";

function findOnPath(cmd: string): string | undefined {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function resolveFfmpegPath(): string | undefined {
  if (process.env.FFMPEG_PATH) {
    return fs.existsSync(process.env.FFMPEG_PATH) ? process.env.FFMPEG_PATH : undefined;
  }
  const bundled = path.join(process.cwd(), "bin", "ffmpeg");
  if (fs.existsSync(bundled)) return bundled;
  return findOnPath("ffmpeg");
}

/**
 * ffmpeg is optional. Without it, XDrop serves only media that already
 * exists as one audio+video file (what it always did). With it, yt-dlp
 * can combine separate video-only and audio-only streams on the fly —
 * which is what unlocks the highest qualities on Instagram/Facebook
 * (their best streams are DASH, video and audio split) and X videos that
 * are only offered as HLS — and extract MP3 audio.
 *
 * On a VPS: `apt install ffmpeg` (found on PATH) or set FFMPEG_PATH. On
 * Vercel there's normally none, and every merged/audio variant is simply
 * not offered — nothing else changes.
 */
export const ffmpegPath: string | undefined = resolveFfmpegPath();

export function hasFfmpeg(): boolean {
  return ffmpegPath !== undefined;
}
