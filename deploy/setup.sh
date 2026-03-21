#!/bin/bash
# =============================================================
# Xpress Tech Portal — EC2 Setup Script (Ubuntu 24.04 ARM/x86)
# Run this ONCE on a fresh EC2 instance.
# Usage: chmod +x setup.sh && sudo ./setup.sh yourdomain.com
# =============================================================
set -euo pipefail

APP_USER="xpress"
APP_DIR="/opt/xpress-tech-portal"
DOMAIN="${1:-}"

echo "=== 1. System updates ==="
apt-get update && apt-get upgrade -y

echo "=== 2. Install system dependencies ==="
apt-get install -y \
  python3 python3-pip python3-venv \
  nginx certbot python3-certbot-nginx \
  tesseract-ocr \
  git curl unzip \
  awscli

# PostgreSQL 16
apt-get install -y postgresql postgresql-contrib libpq-dev

# Node 20 via NodeSource
NODE_MAJOR=$(node -v 2>/dev/null | grep -oP '(?<=v)\d+' || echo "0")
if [ "$NODE_MAJOR" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "=== 3. Configure PostgreSQL ==="
systemctl enable postgresql
systemctl start postgresql

# Generate a random database password
DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)

# Create database user and database
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'xpresstech') THEN
    CREATE ROLE xpresstech WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE xpresstech OWNER xpresstech'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'xpresstech')\gexec
SQL

# Restrict connections to local only (already default, but be explicit)
echo "=== 4. Create app user and directory ==="
id -u $APP_USER &>/dev/null || useradd --system --shell /bin/bash --home $APP_DIR $APP_USER
mkdir -p $APP_DIR
chown $APP_USER:$APP_USER $APP_DIR

echo "=== 5. Clone or copy project ==="
if [ -d "$APP_DIR/backend/app" ]; then
  echo ">> Project files already present at $APP_DIR"
else
  echo ">> Copy your project files to $APP_DIR, then re-run."
  echo ">> e.g.: scp -r ./* ec2-user@<IP>:$APP_DIR/"
fi

echo "=== 6. Setup backend ==="
cd $APP_DIR/backend
sudo -u $APP_USER python3 -m venv venv
sudo -u $APP_USER ./venv/bin/pip install --upgrade pip
sudo -u $APP_USER ./venv/bin/pip install -r requirements.txt

echo "=== 7. Setup frontend ==="
cd $APP_DIR/frontend
sudo -u $APP_USER npm ci
sudo -u $APP_USER npm run build

echo "=== 8. Create upload directory ==="
mkdir -p $APP_DIR/backend/uploads
chown $APP_USER:$APP_USER $APP_DIR/backend/uploads

echo "=== 9. Generate secrets and create .env ==="
JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

if [ ! -f "$APP_DIR/backend/.env" ]; then
cat > $APP_DIR/backend/.env << ENVEOF
ENVIRONMENT=production
DATABASE_URL=postgresql://xpresstech:${DB_PASS}@localhost:5432/xpresstech
JWT_SECRET_KEY=${JWT_SECRET}
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
UPLOAD_DIR=./uploads
FIELD_ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Frontend URL (update after setting up domain + SSL)
FRONTEND_URL=https://${DOMAIN:-yourdomain.com}
CORS_ORIGINS=https://${DOMAIN:-yourdomain.com}

# OCR
OCR_ENGINE=tesseract

# Optional — uncomment and fill in as needed:
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your@email.com
# SMTP_PASSWORD=app-password
# OPENAI_API_KEY=sk-...
# S3_BUCKET_NAME=your-bucket
# S3_REGION=ap-southeast-2
# LEND_API_KEY=
# LEND_API_SECRET=
ENVEOF
chown $APP_USER:$APP_USER $APP_DIR/backend/.env
chmod 600 $APP_DIR/backend/.env
echo ""
echo ">> .env created with auto-generated secrets."
echo ">> DB password: ${DB_PASS}"
echo ">> IMPORTANT: Save this password somewhere safe!"
echo ""
else
  echo ">> .env already exists, skipping."
fi

echo "=== 10. Install systemd service ==="
cp $APP_DIR/deploy/xpress-backend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable xpress-backend
systemctl start xpress-backend

echo "=== 11. Install Nginx config ==="
# Substitute domain if provided
if [ -n "$DOMAIN" ]; then
  sed "s/server_name _;/server_name ${DOMAIN};/" $APP_DIR/deploy/nginx.conf > /etc/nginx/sites-available/xpress
else
  cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/xpress
fi
ln -sf /etc/nginx/sites-available/xpress /etc/nginx/sites-enabled/xpress
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 12. Setup daily database backup ==="
mkdir -p /opt/backups/xpress
chown $APP_USER:$APP_USER /opt/backups/xpress
cp $APP_DIR/deploy/backup.sh /etc/cron.daily/xpress-backup
chmod +x /etc/cron.daily/xpress-backup

echo "=== 13. Set up SSL (HTTPS) ==="
if [ -n "$DOMAIN" ]; then
  echo ">> Requesting Let's Encrypt certificate for ${DOMAIN}..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  echo ">> SSL certificate installed. HTTPS is active."
  echo ">> Auto-renewal is enabled via certbot systemd timer."
else
  echo ">> No domain provided — skipping SSL setup."
  echo ">> Run manually later: sudo certbot --nginx -d yourdomain.com"
fi

echo ""
echo "========================================="
echo " Setup complete!"
echo "========================================="
echo ""
echo "Credentials (SAVE THESE):"
echo "  DB password:      ${DB_PASS}"
echo "  JWT secret:       ${JWT_SECRET}"
echo "  Encryption key:   ${ENCRYPTION_KEY}"
echo ""
echo "Next steps:"
echo "  1. Review /opt/xpress-tech-portal/backend/.env"
echo "  2. sudo systemctl restart xpress-backend"
if [ -z "$DOMAIN" ]; then
  echo "  3. Point your domain's DNS A record to this server's IP"
  echo "  4. Set up SSL: sudo certbot --nginx -d yourdomain.com"
else
  echo "  3. Verify: curl https://${DOMAIN}/api/health"
fi
echo ""
