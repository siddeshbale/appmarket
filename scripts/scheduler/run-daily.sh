#!/usr/bin/env sh
# Once-daily collection for App Market Radar (Linux/macOS). Invoked by cron; safe to run manually.
set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
mkdir -p logs
npm run ingest -- --backup >> "logs/ingest-$(date -u +%F).log" 2>&1
