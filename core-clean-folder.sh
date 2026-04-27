#!/usr/bin/env bash
#
# clean-revdoku-core-folder.sh — wipe the published Core tree at
# ../revdoku/ (or a custom path) but PRESERVE the operator's local files
# listed in PRESERVE_AT_DEST inside ee/scripts/build-core.sh.
#
# Reusable from any wrapper that wants a "fresh tree" before re-running
# build-core.sh:
#   - wipe-build-core.sh — uses it before regenerating Core in place
#   - docker-build-and-run-core.sh — can use it before a clean Docker run
#   - manual ops — `bash clean-revdoku-core-folder.sh` from a fresh shell
#
# Usage:
#   clean-revdoku-core-folder.sh                # target: ../revdoku
#   clean-revdoku-core-folder.sh /path/to/tree  # target: explicit path
#
# Exit code 0 even if the tree didn't exist (idempotent).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$ROOT/revdoku}"
BUILD_SCRIPT="$ROOT/revdoku-ee/ee/scripts/build-core.sh"

# Single source of truth for the preserve list lives in build-core.sh
# (PRESERVE_AT_DEST array). Pull it out without executing the rest of
# the script — extract the array literal between the opening `(` and
# the closing `)`, drop comment-only lines, and re-eval it here so
# changes to build-core.sh propagate automatically.
PRESERVE_AT_DEST=()
if [[ -f "$BUILD_SCRIPT" ]]; then
  array_body="$(awk '/^PRESERVE_AT_DEST=\(/{flag=1;next} /^\)/{flag=0} flag' "$BUILD_SCRIPT" \
                | grep -vE '^\s*#' \
                | tr '\n' ' ')"
  if [[ -n "$array_body" ]]; then
    eval "set -- $array_body"
    PRESERVE_AT_DEST=("$@")
  fi
fi
# Defensive fallback if extraction fails — at minimum we always preserve
# .env.local, since that's the operator's secrets file.
if [[ ${#PRESERVE_AT_DEST[@]} -eq 0 ]]; then
  PRESERVE_AT_DEST=(".env.local")
fi

if [[ ! -d "$DEST" ]]; then
  echo "[clean] $DEST does not exist — nothing to clean"
  exit 0
fi

echo "[clean] target: $DEST"
echo "[clean] preserving: ${PRESERVE_AT_DEST[*]}"

# Build a `find` predicate that excludes every preserved file from
# deletion. Each entry in PRESERVE_AT_DEST is treated as a path
# relative to $DEST. We match the exact path AND any descendants
# (so preserving a directory keeps its whole subtree).
prune_args=()
for rel in "${PRESERVE_AT_DEST[@]}"; do
  prune_args+=(-not -path "$DEST/$rel" -not -path "$DEST/$rel/*")
done

# `-mindepth 1` skips $DEST itself; we want it to remain as an empty
# (or near-empty) directory. `-depth` ensures children are removed
# before their parents so directories are emptied first. The `-print`
# pipeline gives a count for the operator without spamming every path.
removed=$(find "$DEST" -mindepth 1 "${prune_args[@]}" -depth -print 2>/dev/null | wc -l | tr -d ' ')
find "$DEST" -mindepth 1 "${prune_args[@]}" -depth -delete 2>/dev/null || true

echo "[clean] removed $removed entries; $DEST is now reset (preserved files intact)"
