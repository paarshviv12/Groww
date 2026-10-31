#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
(cd chain && npm install)
(cd app && npm install)
echo "Setup done."
