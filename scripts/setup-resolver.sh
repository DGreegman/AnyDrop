#!/usr/bin/env bash
# Explicitly (re-)fetches the latest yt-dlp binaries into web/bin/.
#
# You normally don't need to run this by hand — `npm install` inside web/
# does it automatically via postinstall (see web/scripts/fetch-yt-dlp.sh),
# including on Vercel's own build, which is what actually gets the
# resolver binary into a deployed build (web/bin/* is gitignored, not
# committed). Run this script directly when you want to force-refetch the
# latest yt-dlp release, e.g. to pick up an update.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT_DIR/web/scripts/fetch-yt-dlp.sh" --force
