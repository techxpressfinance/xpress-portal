#!/bin/bash
# =============================================================
# Daily PostgreSQL backup to S3 (or local /opt/backups)
# Install: sudo cp backup.sh /etc/cron.daily/xpress-backup
# =============================================================
set -euo pipefail

BACKUP_DIR="/opt/backups/xpress"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/xpresstech_${TIMESTAMP}.sql"
S3_BUCKET="${S3_BACKUP_BUCKET:-}"
KEEP_LOCAL_DAYS=7

mkdir -p "$BACKUP_DIR"

# PostgreSQL backup using pg_dump (runs as postgres user)
sudo -u postgres pg_dump --format=custom --compress=6 xpresstech > "$BACKUP_FILE"
gzip "$BACKUP_FILE"

echo "$(date) — Backup created: ${BACKUP_FILE}.gz"

# Upload to S3 if bucket is configured
if [ -n "$S3_BUCKET" ]; then
    aws s3 cp "${BACKUP_FILE}.gz" "s3://${S3_BUCKET}/backups/xpress/xpresstech_${TIMESTAMP}.sql.gz"
    echo "$(date) — Uploaded to s3://${S3_BUCKET}"
fi

# Clean up local backups older than N days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_LOCAL_DAYS -delete
