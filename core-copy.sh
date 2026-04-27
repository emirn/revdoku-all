#!/usr/bin/env bash
#
# core-copy.sh — regenerate the published Core tree at ../revdoku/
# from the EE source.
#
# Runtime data in gitignored paths (apps/web/storage/, apps/web/log/,
# tmp/, node_modules/, .bundle/, vendor/bundle/, root .env.local etc.)
# is PRESERVED — these survive via the --exclude list in
# ee/scripts/build-core.sh's final rsync --delete pass. Stale SOURCE
# files no longer present in revdoku-ee/ are removed by --delete, so
# the published tree always exactly matches the source-of-truth while
# local DBs / uploads / installed deps stay put.
#
# For a hard wipe of disk files (including gitignored runtime data),
# run core-clean-folder.sh first and then this script.
#
# For other use cases:
#   - hard wipe the published tree:    bash core-clean-folder.sh
#   - rebuild + run via Docker:        bash core-docker-rebuild-run.sh
#   - wipe Docker volume (DB+uploads): bash core-docker-reset.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[core-copy] regenerating Core from $ROOT/revdoku-ee/"
cd "$ROOT/revdoku-ee"
bash ee/scripts/build-core.sh

cd "$ROOT/revdoku"
echo "[core-copy] done — tree at $ROOT/revdoku is up to date (runtime data preserved)"
