#!/usr/bin/env bash
# Updates the Mustela server to the newest code from GitHub and restarts it (your data stays).
#   ./update.sh
set -euo pipefail
cd "$(dirname "$0")"
git -C ../.. pull --ff-only
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
echo "Updated. Check: https://$(grep ^DOMAIN= .env | cut -d= -f2)/v1/health"
