#!/usr/bin/env bash
# Starts GROWW on a host like Render.
#  - NETWORK=mainnet : uses HashKey Chain mainnet (needs SETTLER_ADDRESS, AGENT_KEY, MERCHANT_PAY_TO, DEMO_KEY).
#  - otherwise       : starts a private test chain inside this service, deploys the contracts, then starts the site.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${NETWORK:-local}" != "mainnet" ]; then
  export NETWORK=local
  (cd chain && npx hardhat node --hostname 127.0.0.1 --port 8545 > /tmp/hardhat-node.log 2>&1 &)
  for i in $(seq 1 60); do
    curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' http://127.0.0.1:8545 >/dev/null 2>&1 && break
    sleep 1
  done
  (cd chain && npx hardhat run scripts/deploy.ts --network localhost)
  # Fresh Hardhat node: these addresses are deterministic. AGENT_KEY is Hardhat's public test key (fake money only).
  export SETTLER_ADDRESS="${SETTLER_ADDRESS:-0x5fbdb2315678afecb367f032d93f642f64180aa3}"
  export USDC_ADDRESS="${USDC_ADDRESS:-0xe7f1725e7734ce288f8367e1bb143e90bb3f0512}"
  export AGENT_KEY="${AGENT_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
  export MERCHANT_PAY_TO="${MERCHANT_PAY_TO:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
fi

cd app
exec npx next start -p "${PORT:-3000}"
