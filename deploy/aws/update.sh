#!/usr/bin/env bash
# Aggiornamento del codice sul server (sostituisce "railway up"). Da lanciare come root:
#   sudo bash /opt/cantina/deploy/aws/update.sh [branch]
# Le migrazioni si applicano da sole all'avvio, dopo una copia del database in /data/backups/.
set -euo pipefail
BRANCH="${1:-main}"
cd /opt/cantina
sudo -u cantina git fetch origin "$BRANCH"
sudo -u cantina git checkout -B "$BRANCH" "origin/$BRANCH"
sudo -u cantina npm ci --omit=dev
# I test usano un database temporaneo, non toccano /data.
sudo -u cantina npm test
systemctl restart cantina
sleep 3
systemctl is-active --quiet cantina && curl -fsS -o /dev/null http://127.0.0.1:3000/ && echo ">> OK: $(git log -1 --oneline)"
