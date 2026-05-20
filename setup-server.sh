#!/usr/bin/env bash
# setup-server.sh — Run once on a fresh Ubuntu 24.04 Droplet to get quadspectat.com live.
# Usage: bash setup-server.sh
# Requires: root or sudo access, DNS already pointing to this server's IP.

set -euo pipefail

DOMAIN="quadspectat.com"
APP_DIR="/opt/quadspectat"
WEB_DIR="/var/www/quadspectat"
DATA_DIR="/var/lib/quadspectat"
REPO_URL="https://github.com/QuadSpectat/QuadSpectat-Site.git"
APP_USER="quadspectat"

echo "=========================================="
echo "  quadspectat.com — server setup script  "
echo "=========================================="

# ── 1. System packages ─────────────────────────────────────────────────────
echo ""
echo "[1/9] Installing system packages..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    git curl wget unzip \
    nginx certbot python3-certbot-nginx \
    gdal-bin libgdal-dev \
    build-essential \
    ca-certificates gnupg

# ── 2. Node.js 20 via NodeSource ──────────────────────────────────────────
echo ""
echo "[2/9] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@latest --activate

# ── 3. PM2 process manager ────────────────────────────────────────────────
echo ""
echo "[3/9] Installing PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ── 4. App user + directories ─────────────────────────────────────────────
echo ""
echo "[4/9] Creating app user and directories..."
id -u "$APP_USER" &>/dev/null || useradd -r -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$WEB_DIR" "$DATA_DIR"
chown "$APP_USER":"$APP_USER" "$APP_DIR" "$DATA_DIR"
chown www-data:www-data "$WEB_DIR"

# ── 5. Clone repository ───────────────────────────────────────────────────
echo ""
echo "[5/9] Cloning repository into $APP_DIR..."
if [ -d "$APP_DIR/.git" ]; then
    echo "  Repository already exists — pulling latest..."
    git -C "$APP_DIR" pull origin main
else
    git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ── 6. Backend .env ──────────────────────────────────────────────────────
echo ""
echo "[6/9] Configuring backend environment..."
if [ ! -f "$APP_DIR/backend/.env" ]; then
    echo "  ⚠️  Creating $APP_DIR/backend/.env — FILL IN YOUR CREDENTIALS!"
    cat > "$APP_DIR/backend/.env" <<'EOF'
PORT=3001
NODE_ENV=production
DATA_DIR=/var/lib/quadspectat

# DigitalOcean Spaces — fill these in
SPACES_KEY=REPLACE_ME
SPACES_SECRET=REPLACE_ME
SPACES_BUCKET=quadspectat-models
SPACES_REGION=fra1
SPACES_ENDPOINT=https://fra1.digitaloceanspaces.com
PRESIGN_EXPIRY_SECONDS=3600
EOF
    echo "  ↳  Edit $APP_DIR/backend/.env with your Spaces credentials before continuing!"
    echo "     Press Enter when done..."
    read -r
fi

# ── 7. Build backend ──────────────────────────────────────────────────────
echo ""
echo "[7/9] Building backend..."
cd "$APP_DIR/backend"
pnpm install --frozen-lockfile
pnpm build

# Start / restart with PM2
pm2 describe quadspectat-backend &>/dev/null \
    && pm2 restart quadspectat-backend \
    || pm2 start "$APP_DIR/backend/dist/index.js" \
         --name quadspectat-backend \
         --env production \
         --log /var/log/quadspectat-backend.log \
         --time
pm2 save

cd "$APP_DIR"

# ── 8. Nginx ──────────────────────────────────────────────────────────────
echo ""
echo "[8/9] Configuring Nginx..."
cp "$APP_DIR/nginx.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default   # remove default site

# Placeholder index until we have the real build
mkdir -p "$WEB_DIR"
echo "<html><body>Deploying...</body></html>" > "$WEB_DIR/index.html"
chown -R www-data:www-data "$WEB_DIR"

nginx -t
systemctl reload nginx

# ── 9. SSL via Let's Encrypt ──────────────────────────────────────────────
echo ""
echo "[9/9] Obtaining SSL certificate..."
echo "  Note: Requires DNS A record for $DOMAIN pointing to this server's IP."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos \
    --email admin@"$DOMAIN" \
    --redirect || echo "  ⚠️  Certbot failed — check DNS propagation and run manually later."

# ── Post-setup instructions ──────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  ✅ Server setup complete!               "
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Build the frontend locally and copy to the server:"
echo "     pnpm --filter frontend build"
echo "     rsync -avz frontend/dist/ root@<your-ip>:$WEB_DIR/"
echo ""
echo "  2. Set up GitHub Actions secrets for auto-deploy:"
echo "     DEPLOY_HOST       → your droplet IP"
echo "     DEPLOY_USER       → root (or a deploy user)"
echo "     DEPLOY_SSH_KEY    → your private SSH key"
echo "     VITE_GOOGLE_MAPS_KEY → your Google Maps API key"
echo ""
echo "  3. Verify the backend is running:"
echo "     curl https://$DOMAIN/api/health"
echo ""
echo "  4. Check PM2 logs:"
echo "     pm2 logs quadspectat-backend"
echo ""
echo "  5. For future deploys just push to main — GitHub Actions handles the rest."
echo ""
