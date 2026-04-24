#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "reseting core docker in revdoku"
bash reset-core-docker.sh

pushd "$ROOT/revdoku-ee" >/dev/null
bash ee/scripts/build-core.sh
popd >/dev/null

cd "$ROOT/revdoku"
# Force a local build + no ghcr pull so the freshly-stripped core code
# in this repo is what actually runs. Without this, docker-compose.yml
# defaults to pulling ghcr.io/revdoku/revdoku-app:latest and your local
# build-core.sh output is ignored.
export REVDOKU_IMAGE="revdoku-core:local"
exec ./bin/start --build --pull=never "$@"
