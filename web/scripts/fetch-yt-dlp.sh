#!/usr/bin/env bash
# Fetches the yt-dlp binaries into ./bin/ (relative to web/, where this
# script lives). Runs automatically as `postinstall` on every `npm install`
# — including Vercel's own build — specifically so the binary the resolver
# needs actually ends up in the deployed artifact. web/bin/* is gitignored
# (they're 3-40MB binaries, not source), so without this, a deploy built
# straight from git has no resolver binary at all and every /resolve call
# fails with VIDEO_RESOLUTION_FAILED ("The video resolver is unavailable").
#
# Idempotent by default (skips a binary that's already present, so repeat
# local `npm install`s don't redownload). Pass --force to always refetch
# the latest release, e.g. to pick up a yt-dlp update.
set -euo pipefail

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
mkdir -p "$BIN_DIR"

fetch() {
  local name="$1" dest="$BIN_DIR/$1"
  if [[ -f "$dest" && "$FORCE" -eq 0 ]]; then
    echo "$name already present, skipping (use --force to refetch)."
    return
  fi
  echo "Fetching $name..."
  curl -sL --retry 3 --retry-delay 2 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$name" -o "$dest"
  chmod +x "$dest"
}

# The standalone build is the one that actually matters for a Vercel
# deploy (no python3 dependency there) — fetch it unconditionally.
fetch yt-dlp_linux

# The lightweight zipapp is only useful where python3 is on PATH (local
# dev, most self-hosted deploys) — skip it in Vercel's build to save time,
# since it would never be selected there anyway (see lib/videos/config.ts).
if [[ -z "${VERCEL:-}" ]]; then
  fetch yt-dlp
fi

echo "yt-dlp binaries ready in $BIN_DIR"
