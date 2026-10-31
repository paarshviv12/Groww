#!/usr/bin/env bash
# With mainnet-serve.sh running in another terminal: makes ONE real payment and saves it for replay.
set -euo pipefail
cd "$(dirname "$0")/app"
BASE="${BASE:-http://localhost:3000}" MODE=pay SERVICE=chain-pulse npx tsx scripts/record-run.mts
echo "Saved to app/public/runs/latest.json. Rebuild before deploying so the file ships."
