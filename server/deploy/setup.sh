#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu server (Oracle Cloud's free one, or any other):
#   installs Docker, opens the web ports, starts the Mustela server with HTTPS, and adds a daily backup.
# Run from this folder:  sudo bash setup.sh servers.example.com
set -euo pipefail
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Usage: sudo bash setup.sh your.domain"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
cd "$(dirname "$0")"

echo "== Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi

echo "== Web ports 80 and 443"
# Oracle's Ubuntu images block everything but SSH in the machine's own firewall (on top of the cloud's rules).
if command -v iptables >/dev/null && iptables -S INPUT | grep -q REJECT; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null && continue
    at=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')  # just above the "block the rest" rule
    iptables -I INPUT "${at:-1}" -p tcp --dport $p -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi
fi
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp; ufw allow 443/tcp; fi

echo "== Settings"
[ -f .env ] || cp .env.example .env
sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" .env
mkdir -p data && chown 1000:1000 data

echo "== Start"
docker compose up -d --build

echo "== Daily backup (data folder, last 14 days, in ./backups)"
mkdir -p backups
CRON="17 4 * * * cd $(pwd) && mkdir -p backups && tar czf backups/data-\$(date +\%F).tgz data && ls -1t backups/*.tgz | tail -n +15 | xargs -r rm --"
# (|| true: grep finds nothing to keep on a fresh server, which mustn't stop the script)
( crontab -l 2>/dev/null | grep -v "mustela-backup" || true; echo "$CRON # mustela-backup" ) | crontab -

echo
echo "Done. In a minute, https://$DOMAIN/v1/health should answer."
echo "Add https://$DOMAIN in Mustela: Settings > Sync & servers."
