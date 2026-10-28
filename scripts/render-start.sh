#!/usr/bin/env bash
# Render start command (render.yaml). With SEED_DEMO_DATA=true, an empty mock-mode database gets the demo data
# first (seed.js --if-empty leaves existing data alone). exec hands SIGTERM straight to Node for a clean shutdown.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  node apps/api/dist/seed.js --if-empty
fi
exec node apps/api/dist/index.js
