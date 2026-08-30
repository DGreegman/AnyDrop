#!/usr/bin/env bash
# Downloads the yt-dlp binaries used by XVideoResolver (see
# web/lib/videos/resolver.ts and web/lib/videos/config.ts) into web/bin/.
#
# Two variants, on purpose:
#   - yt-dlp          the lightweight Python zipapp (~3MB). Needs python3
#                      on PATH, but starts fast (no self-extraction) — used
#                      whenever python3 is available (local dev, most
#                      self-hosted deploys).
#   - yt-dlp_linux     yt-dlp's standalone, self-contained build (~40MB,
#                      PyInstaller). No python3 dependency at all, which is
#                      what makes it deployable inside a Vercel serverless
#                      function — but it self-extracts to a temp dir on
#                      every invocation, so it's the fallback, not the
#                      default, wherever python3 is available.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/web/bin"

mkdir -p "$BIN_DIR"

echo "Downloading latest yt-dlp (zipapp) to $BIN_DIR/yt-dlp ..."
curl -sL --retry 3 --retry-delay 2 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "$BIN_DIR/yt-dlp"
chmod +x "$BIN_DIR/yt-dlp"

echo "Downloading latest yt-dlp (standalone linux build) to $BIN_DIR/yt-dlp_linux ..."
curl -sL --retry 3 --retry-delay 2 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o "$BIN_DIR/yt-dlp_linux"
chmod +x "$BIN_DIR/yt-dlp_linux"

if command -v python3 >/dev/null 2>&1; then
  "$BIN_DIR/yt-dlp" --version
  echo "python3 found — the fast zipapp will be used by default."
else
  "$BIN_DIR/yt-dlp_linux" --version
  echo "python3 not found — falling back to the standalone binary."
fi
echo "yt-dlp is ready in $BIN_DIR"
