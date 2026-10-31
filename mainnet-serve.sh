#!/usr/bin/env bash
# Starts the app against HSK Chain mainnet using the deployed contract. Open http://localhost:3000
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env.mainnet; set +a
export NETWORK=mainnet
export SETTLER_ADDRESS="$(node -p "require('./chain/deployments/hashkey.json').settler")"
export SETTLER_FROM_BLOCK="$(node -p "require('./chain/deployments/hashkey.json').deployBlock || 0")"
cd app
[ -d .next ] || npx next build
exec npx next start -p "${PORT:-3000}"
