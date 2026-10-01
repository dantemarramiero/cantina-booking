#!/usr/bin/env bash
# Prima installazione su Ubuntu 24.04 (EC2 o Lightsail), da lanciare come root:
#   sudo REPO_URL=https://github.com/dantemarramiero/mywinery.git DATA_DEVICE=/dev/nvme1n1 bash setup.sh
# DATA_DEVICE è il disco EBS dei dati (lsblk per trovarlo). Se è vuoto viene formattato ext4.
set -euo pipefail
: "${REPO_URL:?imposta REPO_URL}"
: "${DATA_DEVICE:?imposta DATA_DEVICE (es. /dev/nvme1n1)}"
BRANCH="${BRANCH:-main}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Node 22 (node:sqlite richiede >= 22.5) e Caddy
apt-get update
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

id cantina >/dev/null 2>&1 || useradd --system --home /opt/cantina --shell /usr/sbin/nologin cantina

# Disco dei dati su /data (montato per UUID, nofail per non bloccare l'avvio se manca)
if ! blkid "$DATA_DEVICE" >/dev/null 2>&1; then mkfs.ext4 -L cantina-data "$DATA_DEVICE"; fi
mkdir -p /data
UUID="$(blkid -s UUID -o value "$DATA_DEVICE")"
grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab
mount -a
chown cantina:cantina /data && chmod 750 /data

# Codice
if [ ! -d /opt/cantina/.git ]; then git clone --branch "$BRANCH" "$REPO_URL" /opt/cantina; fi
chown -R cantina:cantina /opt/cantina
sudo -u cantina bash -c 'cd /opt/cantina && npm ci --omit=dev'

# Configurazione
mkdir -p /etc/cantina
if [ ! -f /etc/cantina/cantina.env ]; then
  install -m 600 -o root -g root "$HERE/cantina.env.example" /etc/cantina/cantina.env
  echo ">> Compila /etc/cantina/cantina.env prima di avviare il servizio."
fi
install -m 644 "$HERE/cantina.service" /etc/systemd/system/cantina.service
install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable cantina caddy

echo ">> Fatto. Prossimi passi: compila cantina.env, copia i dati in /data, poi:"
echo "   systemctl start cantina && systemctl reload caddy"
