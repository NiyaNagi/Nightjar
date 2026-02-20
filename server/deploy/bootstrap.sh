#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — One-time VPS provisioning for night-jar.co
# =============================================================================
#
# Run on a fresh Ubuntu 22.04+ VPS as root (or with sudo):
#   curl -sL https://raw.githubusercontent.com/NiyaNagi/Nightjar/main/server/deploy/bootstrap.sh | bash
#
# What it does:
#   1. Installs Docker, Docker Compose, Nginx
#   2. Creates deploy user with SSH key auth
#   3. Clones the Nightjar repo to /opt/Nightjar
#   4. Creates directory structure for landing page & downloads
#   5. Installs Cloudflare Origin Certificate (you paste it in)
#   6. Links Nginx config and enables the site
#   7. Prints Mailcow migration instructions
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+
#   - Root access
#   - Mailcow already installed at /opt/mailcow-dockerized
#   - A Cloudflare Origin Certificate generated for *.night-jar.co
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }

REPO_DIR="/opt/Nightjar"
WEB_DIR="/var/www/night-jar"
CERT_DIR="/etc/ssl/cloudflare"
DEPLOY_USER="deploy"

# =============================================================================
# 1. System packages
# =============================================================================
log "Updating system packages..."
apt-get update -qq
apt-get install -y -qq curl git nginx ufw apt-transport-https ca-certificates gnupg lsb-release

# =============================================================================
# 2. Docker (if not installed)
# =============================================================================
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  log "Docker already installed: $(docker --version)"
fi

# Docker Compose plugin (v2)
if ! docker compose version &>/dev/null; then
  log "Installing Docker Compose plugin..."
  apt-get install -y -qq docker-compose-plugin
else
  log "Docker Compose already installed: $(docker compose version)"
fi

# =============================================================================
# 3. Deploy user
# =============================================================================
if ! id "$DEPLOY_USER" &>/dev/null; then
  log "Creating deploy user..."
  useradd -m -s /bin/bash -G docker "$DEPLOY_USER"
  mkdir -p /home/$DEPLOY_USER/.ssh
  chmod 700 /home/$DEPLOY_USER/.ssh
  touch /home/$DEPLOY_USER/.ssh/authorized_keys
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
  warn "Add your CI/CD public key to /home/$DEPLOY_USER/.ssh/authorized_keys"
else
  log "Deploy user '$DEPLOY_USER' already exists"
fi

# =============================================================================
# 4. Clone / update repo
# =============================================================================
if [ -d "$REPO_DIR/.git" ]; then
  log "Repo exists at $REPO_DIR — pulling latest..."
  cd "$REPO_DIR" && git pull --ff-only
else
  log "Cloning Nightjar to $REPO_DIR..."
  git clone https://github.com/NiyaNagi/Nightjar.git "$REPO_DIR"
fi
chown -R $DEPLOY_USER:$DEPLOY_USER "$REPO_DIR"

# =============================================================================
# 5. Web directories
# =============================================================================
log "Creating web directories..."
mkdir -p "$WEB_DIR/download" "$WEB_DIR/docs" "$WEB_DIR/content" "$WEB_DIR/screenshots"

# Copy landing page
if [ -f "$REPO_DIR/frontend/public-site/index.html" ]; then
  cp "$REPO_DIR/frontend/public-site/index.html" "$WEB_DIR/index.html"
  log "Landing page copied to $WEB_DIR"
fi

# Copy docs wiki
if [ -d "$REPO_DIR/frontend/public-site/docs" ]; then
  cp -r "$REPO_DIR/frontend/public-site/docs/"* "$WEB_DIR/docs/" 2>/dev/null || true
  log "Docs wiki copied to $WEB_DIR/docs"
fi

# Copy shared content JSON
if [ -d "$REPO_DIR/frontend/public-site/content" ]; then
  cp -r "$REPO_DIR/frontend/public-site/content/"* "$WEB_DIR/content/" 2>/dev/null || true
  log "Content JSON copied to $WEB_DIR/content"
fi

# Copy logo for the landing page
if [ -f "$REPO_DIR/frontend/public/assets/nightjar-logo.png" ]; then
  cp "$REPO_DIR/frontend/public/assets/nightjar-logo.png" "$WEB_DIR/nightjar-logo.png"
fi
if [ -f "$REPO_DIR/assets/icons/nightjar-64.png" ]; then
  cp "$REPO_DIR/assets/icons/nightjar-64.png" "$WEB_DIR/nightjar-64.png"
fi

chown -R www-data:www-data "$WEB_DIR"

# =============================================================================
# 6. Cloudflare Origin Certificate
# =============================================================================
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/night-jar.co.pem" ]; then
  warn "Cloudflare Origin Certificate not found."
  echo ""
  echo "  Generate one at: Cloudflare → SSL/TLS → Origin Server → Create Certificate"
  echo "  Hostnames: *.night-jar.co, night-jar.co"
  echo ""
  echo "  Then paste the certificate and key into:"
  echo "    $CERT_DIR/night-jar.co.pem"
  echo "    $CERT_DIR/night-jar.co.key"
  echo ""
  echo "  chmod 600 $CERT_DIR/night-jar.co.key"
  echo ""
else
  log "Cloudflare Origin Certificate found at $CERT_DIR"
fi

# =============================================================================
# 7. Nginx configuration
# =============================================================================
log "Installing Nginx site config..."
cp "$REPO_DIR/server/deploy/nginx.conf" /etc/nginx/sites-available/night-jar
ln -sf /etc/nginx/sites-available/night-jar /etc/nginx/sites-enabled/night-jar
rm -f /etc/nginx/sites-enabled/default

# Test and reload
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "Nginx config valid — reloaded"
else
  warn "Nginx config test failed — check certs & config before reloading"
fi

# =============================================================================
# 8. Daily cron for cert reload
# =============================================================================
CRON_FILE="/etc/cron.d/nightjar-nginx-reload"
if [ ! -f "$CRON_FILE" ]; then
  log "Adding daily nginx reload cron (picks up renewed Mailcow certs)..."
  echo "0 4 * * * root /usr/sbin/nginx -s reload 2>/dev/null" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
fi

# =============================================================================
# 9. Firewall
# =============================================================================
log "Configuring UFW firewall..."
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP (redirect)
ufw allow 443/tcp  # HTTPS
ufw allow 25/tcp   # SMTP
ufw allow 465/tcp  # SMTPS
ufw allow 587/tcp  # Submission
ufw allow 993/tcp  # IMAPS
ufw allow 4190/tcp # ManageSieve
ufw --force enable
log "UFW enabled"

# =============================================================================
# 10. Print next steps
# =============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "Bootstrap complete! Next steps:"
echo ""
echo "  1. CLOUDFLARE ORIGIN CERT (if not done):"
echo "     Paste cert → $CERT_DIR/night-jar.co.pem"
echo "     Paste key  → $CERT_DIR/night-jar.co.key"
echo "     chmod 600 $CERT_DIR/night-jar.co.key"
echo ""
echo "  2. MAILCOW PORT MIGRATION:"
echo "     cd /opt/mailcow-dockerized"
echo "     Edit mailcow.conf and change:"
echo "       HTTP_PORT=8080"
echo "       HTTP_BIND=127.0.0.1"
echo "       HTTPS_PORT=8443"
echo "       HTTPS_BIND=127.0.0.1"
echo "     Then: docker compose down && docker compose up -d"
echo ""
echo "  3. DEPLOY USER SSH KEY:"
echo "     Paste your CI/CD public key into:"
echo "     /home/$DEPLOY_USER/.ssh/authorized_keys"
echo ""
echo "  4. GITHUB SECRETS (add to repo settings):"
echo "     DEPLOY_HOST    = $(curl -s ifconfig.me || echo '<your-server-ip>')"
echo "     DEPLOY_USER    = $DEPLOY_USER"
echo "     DEPLOY_SSH_KEY = <private key matching the public key above>"
echo "     GITHUB_PAT     = <fine-grained PAT with Issues read/write on NiyaNagi/Nightjar>"
echo ""
echo "  5. START NIGHTJAR CONTAINERS:"
echo "     cd $REPO_DIR"
echo "     docker compose -f server/deploy/docker-compose.prod.yml up -d --build"
echo ""
echo "  6. BREVO SMTP RELAY (if port 25 outbound is blocked):"
echo "     Mailcow Admin → System → Configuration → Routing"
echo "     All → smtp-relay.brevo.com:587 → username + SMTP key"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
