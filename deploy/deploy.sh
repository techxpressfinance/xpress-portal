#!/bin/bash
# =============================================================
# Xpress Tech Portal — Redeploy Script
# Run this after pushing code updates to the server
# Usage: sudo ./deploy.sh
# =============================================================
set -euo pipefail

APP_DIR="/opt/xpress-tech-portal"
APP_USER="xpress"

echo "=== Pulling latest code ==="
cd $APP_DIR
sudo -u $APP_USER git pull

echo "=== Updating backend dependencies ==="
cd $APP_DIR/backend
sudo -u $APP_USER ./venv/bin/pip install -r requirements.txt --quiet

echo "=== Rebuilding frontend ==="
cd $APP_DIR/frontend
sudo -u $APP_USER npm ci --silent
sudo -u $APP_USER npm run build

echo "=== Running database backup before restart ==="
/etc/cron.daily/xpress-backup || echo "Backup skipped (non-critical)"

echo "=== Restarting backend ==="
systemctl restart xpress-backend

echo "=== Done! ==="
systemctl status xpress-backend --no-pager
