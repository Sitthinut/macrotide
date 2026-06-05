#!/usr/bin/env bash
# Run a macrotide job as a ONE-OFF container instead of `docker exec` into the
# live app container — so an app redeploy (`docker compose up --build`) can never
# SIGKILL an in-flight job. (Issue #115: a mid-crawl deploy recreated the app
# container and killed three nightly catalog refreshes; confirmed via dockerd
# events.)
#
# The job shares the app's image, env_file (.env.local) and ./data volume via the
# compose `macrotide` service definition; `run --rm` spins an ephemeral container,
# overrides the image CMD (`npm run start`) with the script, and removes the
# container on exit. `--no-deps` keeps it from touching the running app service.
# The host systemd timers call this instead of `docker exec`.
#
# Usage (run from anywhere; resolves the compose dir itself):
#   scripts/run-job.sh <script-basename> [args…]
#   e.g.  scripts/run-job.sh refresh-fund-catalog
#         scripts/run-job.sh prewarm-nav --range=1mo --retail-only
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <script-basename> [args…]" >&2
  exit 2
fi

job="$1"
shift
cd "$(dirname "$0")/.." # repo root = the compose project dir

exec docker compose run --rm --no-deps macrotide \
  npx tsx --tsconfig tsconfig.scripts.json "scripts/${job}.ts" "$@"
