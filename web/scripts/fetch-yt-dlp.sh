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
# the latest release, e.g. to pick up a yt-dlp update (`npm run
# update-resolver` does exactly that).
#
# Every download is checked against the SHA2-256SUMS file published with
# the same release, and a mismatch aborts without replacing the existing
# binary — this is code that runs on the server, so it's never installed
# unverified. Both files come from one pinned release tag (resolved once
# up front), so a release landing mid-script can't pair a binary with the
# wrong checksum list.
set -euo pipefail

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
mkdir -p "$BIN_DIR"

RELEASES="https://github.com/yt-dlp/yt-dlp/releases"
TAG=""
SUMS=""

resolve_release() {
  [[ -n "$TAG" ]] && return
  # /releases/latest redirects to /releases/tag/<tag>.
  TAG="$(curl -fsSIL --retry 3 --retry-delay 2 -o /dev/null -w '%{url_effective}' "$RELEASES/latest" | sed 's#.*/tag/##')"
  if [[ -z "$TAG" || "$TAG" == *"/"* ]]; then
    echo "Couldn't determine the latest yt-dlp release." >&2
    exit 1
  fi
  SUMS="$(curl -fsSL --retry 3 --retry-delay 2 "$RELEASES/download/$TAG/SHA2-256SUMS")"
  echo "yt-dlp release $TAG"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# fetch <asset name on the release> [<local file name>]
fetch() {
  local asset="$1" name="${2:-$1}"
  local dest="$BIN_DIR/$name"
  if [[ -f "$dest" && "$FORCE" -eq 0 ]]; then
    echo "$name already present, skipping (use --force to refetch)."
    return
  fi
  resolve_release
  echo "Fetching $asset..."
  local tmp="$dest.download"
  curl -fsSL --retry 3 --retry-delay 2 "$RELEASES/download/$TAG/$asset" -o "$tmp"

  local expected actual
  expected="$(printf '%s\n' "$SUMS" | awk -v f="$asset" '$2 == f { print $1 }')"
  actual="$(sha256_of "$tmp")"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    rm -f "$tmp"
    echo "Checksum mismatch for $asset (expected ${expected:-<missing>}, got $actual) — not installed." >&2
    exit 1
  fi
  chmod +x "$tmp"
  mv "$tmp" "$dest"
}

# The standalone build is the one that actually matters for a Vercel
# deploy (no python3 dependency there) and for TikTok everywhere — fetch
# it unconditionally. It's architecture-specific: an ARM server (common
# for cheap VPSes) needs the aarch64 build, saved under the same local
# name so lib/media/yt-dlp.ts doesn't need to care.
case "$(uname -m)" in
  aarch64 | arm64) fetch yt-dlp_linux_aarch64 yt-dlp_linux ;;
  *) fetch yt-dlp_linux ;;
esac

# The lightweight zipapp is only useful where python3 is on PATH (local
# dev, most self-hosted deploys) — skip it in Vercel's build to save time,
# since it would never be selected there anyway (see lib/media/yt-dlp.ts).
if [[ -z "${VERCEL:-}" ]]; then
  fetch yt-dlp
fi

echo "yt-dlp binaries ready in $BIN_DIR"
