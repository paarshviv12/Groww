#!/usr/bin/env bash
# Deploys the MandateSettler contract to HSK Chain mainnet (chain 177) using the agent wallet.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env.mainnet; set +a
(cd chain && npx hardhat test && npx hardhat run scripts/deploy.ts --network hashkey)
echo
echo "Deployed. Details saved in chain/deployments/hashkey.json"
