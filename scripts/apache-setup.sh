#!/usr/bin/env bash
# One-time Apache2 setup for KansoState.
# Run with sudo: sudo bash scripts/apache-setup.sh
#
# What it does:
#   1. Enables the proxy/WebSocket/header modules
#   2. Installs the VirtualHost configs
#   3. Installs certbot and gets SSL certs for all three subdomains
#   4. Restarts Apache2

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APACHE_SITES="/etc/apache2/sites-available"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${CYAN}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
info() { echo -e "${YELLOW}  $*${NC}"; }

# Must be root
[[ "$EUID" -eq 0 ]] || { echo "Run with sudo: sudo bash scripts/apache-setup.sh"; exit 1; }

# ── 1. Enable required modules ────────────────────────────────────────────────
step "Enabling Apache2 modules"
a2enmod proxy proxy_http proxy_wstunnel ssl headers rewrite
ok "Modules enabled"

# ── 2. Install VirtualHost configs ────────────────────────────────────────────
step "Installing VirtualHost configs"
cp "$REPO_ROOT/infra/apache/kansostate.conf"         "$APACHE_SITES/"
cp "$REPO_ROOT/infra/apache/kansostate-api.conf"     "$APACHE_SITES/"
cp "$REPO_ROOT/infra/apache/kansostate-grafana.conf" "$APACHE_SITES/"

a2ensite kansostate.conf kansostate-api.conf kansostate-grafana.conf
ok "VirtualHosts installed and enabled"

# ── 3. Test config before restarting ─────────────────────────────────────────
step "Testing Apache config"
apache2ctl configtest
ok "Config OK"

# ── 4. Restart Apache ─────────────────────────────────────────────────────────
step "Restarting Apache2"
systemctl restart apache2
ok "Apache2 restarted"

# ── 5. Install certbot and get SSL certs ──────────────────────────────────────
step "Installing certbot"
if ! command -v certbot &>/dev/null; then
  apt-get install -y -qq certbot python3-certbot-apache
  ok "certbot installed"
else
  ok "certbot already installed"
fi

step "Creating ACME challenge webroot"
mkdir -p /var/www/html/.well-known/acme-challenge
ok "Webroot ready"

step "Obtaining SSL certificates"
info "certbot will update the VirtualHost configs to add HTTPS automatically."
certbot --apache \
  -d kansostate.vikrantkumar.site \
  -d api.kansostate.vikrantkumar.site \
  -d grafana.kansostate.vikrantkumar.site \
  --non-interactive \
  --agree-tos \
  --email vikrantkrd@gmail.com \
  --redirect

ok "SSL certificates installed — HTTP automatically redirects to HTTPS"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
ok "Apache setup complete!"
echo ""
echo "  https://kansostate.vikrantkumar.site   → dashboard"
echo "  https://api.kansostate.vikrantkumar.site → sentinel (WebSocket)"
echo "  https://grafana.kansostate.vikrantkumar.site → grafana"
echo ""
info "Certs auto-renew via systemd timer. Check with: certbot renew --dry-run"
