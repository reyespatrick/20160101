#!/usr/bin/env bash
# One-shot installer for an Ubuntu 22.04/24.04 VM (tested layout: Oracle Cloud Always Free).
# Usage (as root):  bash setup.sh <domain> [git-url] [branch]
# Installs Node 22, Caddy (automatic HTTPS), clones the repo to /opt/immoba, builds the PWA,
# creates the service user + /var/lib/immoba, opens ports 80/443 and starts everything.
set -euo pipefail
DOMAIN="${1:?usage: setup.sh <domain> [git-url] [branch]}"
REPO="${2:-https://github.com/reyespatrick/20160101.git}"
BRANCH="${3:-main}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

# --- Node 22 (node:sqlite needs >= 22.5) ---
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

# --- Caddy ---
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

# --- Oracle images ship an iptables policy that drops 80/443: open them and persist ---
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null

# --- service user, data dir, code ---
id -u immoba >/dev/null 2>&1 || useradd --system --home /opt/immoba --shell /usr/sbin/nologin immoba
install -d -o immoba -g immoba -m 750 /var/lib/immoba /var/lib/immoba/photos
if [[ ! -d /opt/immoba/.git ]]; then
  git clone --branch "$BRANCH" "$REPO" /opt/immoba
fi
chown -R immoba:immoba /opt/immoba
sudo -u immoba bash -c "cd /opt/immoba && npm ci --no-audit --no-fund && npm run build"

# --- environment (kept if it already exists so APP_SECRET never changes) ---
install -d -m 750 /etc/immoba
if [[ ! -f /etc/immoba/env ]]; then
  sed -e "s#DOMAIN#$DOMAIN#" -e "s#APP_SECRET=CHANGE_ME#APP_SECRET=$(openssl rand -hex 32)#" /opt/immoba/deploy/env.example > /etc/immoba/env
  chmod 600 /etc/immoba/env
fi

# --- systemd + Caddy ---
install -m 644 /opt/immoba/deploy/immoba.service /etc/systemd/system/immoba.service
sed "s#^DOMAIN #$DOMAIN #" /opt/immoba/deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now immoba
systemctl restart caddy

echo
echo "Immoba is running behind https://$DOMAIN"
echo "Public IP to whitelist in Inmovilla: $(curl -fsS https://api.ipify.org || echo '(check the OCI console)')"
echo "Open the URL on a phone to create the agency and its administrator, then add the keys in Perfil › Claves."
