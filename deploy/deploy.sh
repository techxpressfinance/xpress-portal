#!/bin/bash
# =============================================================
# Xpress Tech Portal — Redeploy Script
# Run this after pushing code updates to the server
# Usage: sudo ./deploy.sh
#
# Order matters: build everything first (the old version keeps serving), then
# back up, then stop -> migrate -> start. The schema is only ever changed by
# `python -m app.migrate` here, never by the app booting, and never without a
# backup taken moments before.
#
#   SKIP_BACKUP=1 sudo -E ./deploy.sh    # only if you have just taken one
# =============================================================
set -euo pipefail

APP_DIR="/opt/xpress-tech-portal"
APP_USER="xpress"
PY="$APP_DIR/backend/venv/bin/python3"

cd $APP_DIR
PREVIOUS=$(sudo -u $APP_USER git rev-parse --short HEAD)

echo "=== Pulling latest code ==="
sudo -u $APP_USER git pull
CURRENT=$(sudo -u $APP_USER git rev-parse --short HEAD)
echo "    $PREVIOUS -> $CURRENT"

EXPECTED_PY=$(cat $APP_DIR/.python-version)
ACTUAL_PY=$($PY -c 'import sys; print("%d.%d" % sys.version_info[:2])')
if [ "$ACTUAL_PY" != "$EXPECTED_PY" ]; then
    echo "ERROR: backend venv runs Python $ACTUAL_PY but the project is pinned to $EXPECTED_PY (.python-version)."
    echo "       Rebuild it: cd backend && python$EXPECTED_PY -m venv --clear venv && venv/bin/pip install -r requirements.txt"
    exit 1
fi

echo "=== Updating backend dependencies ==="
cd $APP_DIR/backend
sudo -u $APP_USER ./venv/bin/pip install -r requirements.txt --quiet

echo "=== Rebuilding frontend ==="
cd $APP_DIR/frontend
sudo -u $APP_USER npm ci --silent
sudo -u $APP_USER npm run build

echo "=== Backing up the database ==="
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
    echo "    SKIP_BACKUP=1 — skipping (you are on your own if the migration goes wrong)"
elif ! /etc/cron.daily/xpress-backup; then
    echo "ERROR: backup failed — not touching the database. Nothing has been restarted;"
    echo "       the previous version is still serving. Fix the backup and re-run."
    exit 1
fi

echo "=== Stopping backend ==="
systemctl stop xpress-backend

echo "=== Migrating the database ==="
# Same user, environment file and working directory as the service itself.
if ! systemd-run --quiet --wait --pipe --collect \
        --uid=$APP_USER --gid=$APP_USER \
        -p EnvironmentFile=$APP_DIR/backend/.env \
        -p WorkingDirectory=$APP_DIR/backend \
        $PY -m app.migrate; then
    echo
    echo "ERROR: migration failed. The backend is STOPPED."
    echo "  To go back to the previous version:"
    echo "    sudo -u $APP_USER git -C $APP_DIR checkout $PREVIOUS"
    echo "    (if the migration half-applied, restore the dump just taken — see deploy/DEPLOYMENT.md)"
    echo "    sudo systemctl start xpress-backend"
    exit 1
fi

echo "=== Starting backend ==="
systemctl start xpress-backend

echo "=== Waiting for the portal to report ready ==="
for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8000/api/health/ready > /dev/null 2>&1; then
        echo "=== Done! $CURRENT is live ==="
        systemctl status xpress-backend --no-pager | head -5
        exit 0
    fi
    sleep 2
done
echo "ERROR: backend did not become ready within 60s. Recent logs:"
journalctl -u xpress-backend -n 40 --no-pager
exit 1
