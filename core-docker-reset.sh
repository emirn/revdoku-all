#!/usr/bin/env bash
#
# core-docker-reset.sh — DESTRUCTIVE. Wipe the Core edition's Docker
# state at ../revdoku/, including the named `storage` volume that backs
# the SQLite databases (production.sqlite3 + audit + cache + queue + cable)
# and any uploaded files.
#
# Use this when:
#   - the container DB has stale Lockbox-encrypted data from a previous
#     LOCKBOX_MASTER_KEY and you want a clean slate
#   - you want to start over from a fresh first-boot bootstrap
#
# Do NOT use this just to pick up code changes — `./bin/start --build`
# rebuilds the image and keeps the volume. Only `down -v` wipes data.
#
# Bypass the prompt (CI / scripted use):
#   CORE_DOCKER_RESET_YES=1 bash core-docker-reset.sh
#   bash core-docker-reset.sh -y
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$ROOT/revdoku"

if [[ ! -d "$DEST" ]]; then
  echo "[core-docker-reset] $DEST does not exist — nothing to reset"
  exit 0
fi

cat <<EOF >&2

  ⚠️  DESTRUCTIVE: this will run \`docker compose down -v\` in
      $DEST

      That removes the named \`storage\` volume, which means:
        • all SQLite databases (users, accounts, envelopes, audit_logs)
        • all ActiveStorage uploads
        • any data created in the running Core container

      Files on disk under $DEST/ are NOT affected — only the Docker
      volume is wiped. Source code, .env.local, and the published
      tree stay intact.

EOF

if [[ "${CORE_DOCKER_RESET_YES:-}" == "1" || "${1:-}" == "-y" || "${1:-}" == "--yes" ]]; then
  echo "[core-docker-reset] CORE_DOCKER_RESET_YES=1 (or -y) — skipping prompt" >&2
else
  read -r -p "  Type 'wipe' to confirm, anything else to abort: " ans
  if [[ "$ans" != "wipe" ]]; then
    echo "[core-docker-reset] aborted — no changes made" >&2
    exit 1
  fi
fi

cd "$DEST"
docker compose down -v
echo "[core-docker-reset] done — Docker volume wiped, image kept"
