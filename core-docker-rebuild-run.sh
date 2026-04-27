#!/usr/bin/env bash
#
# core-docker-rebuild-run.sh — full Core edition iteration loop:
#
#   1. (optional) wipe the Docker volume — only when --reset is passed
#   2. regenerate ../revdoku/ from revdoku-ee/ via build-core.sh
#   3. exec ./bin/start (which itself passes --build --pull=never) so
#      Docker rebuilds the image from the freshly-stripped tree
#
# Default behaviour preserves the running container's SQLite volume —
# code changes pick up via the Docker layer cache rebuild, but data
# stays put. Use --reset (or -r) for a from-scratch boot when you've
# rotated keys, want fresh seeds, etc. That just delegates to
# core-docker-reset.sh, which prompts for confirmation.
#
# Any other args are forwarded to bin/start (e.g. -d for detached).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESET=0
passthrough=()
for arg in "$@"; do
  case "$arg" in
    -r|--reset) RESET=1 ;;
    *) passthrough+=("$arg") ;;
  esac
done

if [[ $RESET -eq 1 ]]; then
  echo "[core-docker-rebuild-run] --reset given → wiping Docker volume first"
  bash "$ROOT/core-docker-reset.sh"
fi

pushd "$ROOT/revdoku-ee" >/dev/null
bash ee/scripts/build-core.sh
popd >/dev/null

cd "$ROOT/revdoku"
# Force a local build + no ghcr pull so the freshly-stripped core code
# in this repo is what actually runs. Without this, docker-compose.yml
# defaults to pulling ghcr.io/revdoku/revdoku-app:latest and your local
# build-core.sh output is ignored.
export REVDOKU_IMAGE="revdoku-core:local"
exec ./bin/start --pull=never "${passthrough[@]}"
