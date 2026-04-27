#!/usr/bin/env bash
#
# core-copy.sh — fully reset the published Core tree at ../revdoku/
# and regenerate it from the EE source. PRESERVES the operator's local
# files listed in PRESERVE_AT_DEST inside ee/scripts/build-core.sh
# (currently just .env.local).
#
# This is wipe + build glue:
#   1. core-clean-folder.sh        — wipes everything except preserved files
#   2. ee/scripts/build-core.sh    — regenerates from EE source
#
# For other use cases:
#   - just wipe the published tree:    bash core-clean-folder.sh
#   - rebuild + run via Docker:        bash core-docker-rebuild-run.sh
#   - wipe Docker volume (DB+uploads): bash core-docker-reset.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$ROOT/core-clean-folder.sh"

echo "[core-copy] regenerating Core from $ROOT/revdoku-ee/"
cd "$ROOT/revdoku-ee"
bash ee/scripts/build-core.sh

cd "$ROOT/revdoku"
echo "[core-copy] done — tree at $ROOT/revdoku is fully fresh"
