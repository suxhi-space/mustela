#!/usr/bin/env bash
# Updates the Mustela server to the newest code from GitHub and restarts it (your data stays).
#   bash update.sh
set -euo pipefail
cd "$(dirname "$0")"
# Pull first, then run the freshly pulled copy of this script, so new steps below always run on this update.
if [ "${1:-}" != "--pulled" ]; then git -C ../.. pull --ff-only; exec bash "$0" --pulled; fi
# The key that encrypts stored profiles and banners: made once, kept in .env (not in data/ or the backups).
if ! grep -q '^DATA_KEY=.\+' .env; then
  sed -i '/^DATA_KEY=/d' .env
  echo "DATA_KEY=$(head -c 32 /dev/urandom | base64)" >> .env
  chmod 600 .env
fi
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
echo "Updated. Check: https://$(grep ^DOMAIN= .env | cut -d= -f2)/v1/health"
