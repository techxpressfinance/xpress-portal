#!/bin/bash
# =============================================================
# Xpress Tech Portal — backup (database + uploaded documents)
#
# Install:  sudo cp deploy/backup.sh /etc/cron.daily/xpress-backup
# Config:   /etc/xpress-backup.conf   (KEY=value lines, see below)
#
#   S3_BACKUP_BUCKET=xpress-backups-prod   # off-box copy. Without it backups
#                                          # live only on this server.
#   REQUIRE_OFFSITE=1                      # fail (exit 1) if there is no bucket
#
# What is backed up
#   * PostgreSQL        pg_dump custom format, verified readable before it counts
#   * uploads/          only when documents are stored on local disk (no
#                       S3_BUCKET_NAME in backend/.env); with S3 document
#                       storage, turn on bucket versioning instead
#
# What is deliberately NOT backed up here
#   * backend/.env and FIELD_ENCRYPTION_KEY. A backup that carries its own
#     decryption key protects nothing. Keep the key ring in AWS Secrets Manager
#     (or the company password manager) — see deploy/DEPLOYMENT.md. Without the
#     key every encrypted column in these dumps is unrecoverable.
#
# Prove the backups work: deploy/restore-test.sh
# =============================================================
set -euo pipefail

[ -f /etc/xpress-backup.conf ] && . /etc/xpress-backup.conf

APP_DIR="${APP_DIR:-/opt/xpress-tech-portal}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/xpress}"
DB_NAME="${DB_NAME:-xpresstech}"
S3_BUCKET="${S3_BACKUP_BUCKET:-}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
PG_SUDO="${PG_SUDO-sudo -u postgres}"
UPLOAD_DIR="${UPLOAD_DIR:-$APP_DIR/backend/uploads}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"
log() { echo "$(date '+%F %T') backup: $*"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# ── Database ──────────────────────────────────────────────────
# Written to a temp name so a half-finished dump is never mistaken for a backup.
$PG_SUDO pg_dump --format=custom --compress=6 "$DB_NAME" > "$DUMP.partial"
# A dump that pg_restore cannot list is not a backup.
pg_restore --list "$DUMP.partial" > /dev/null
mv "$DUMP.partial" "$DUMP"
chmod 600 "$DUMP"
log "database dump ok: $DUMP ($(du -h "$DUMP" | cut -f1))"

# ── Uploaded documents (local storage only) ───────────────────
UPLOADS_ARCHIVE=""
if [ -d "$UPLOAD_DIR" ] && [ -n "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ]; then
    if [ -n "$S3_BUCKET" ]; then
        # Incremental, and never --delete: a file removed (or encrypted by
        # ransomware) on the server must not vanish from the backup.
        aws s3 sync "$UPLOAD_DIR" "s3://${S3_BUCKET}/backups/xpress/uploads/" --sse AES256 --only-show-errors
        log "uploads synced to s3://${S3_BUCKET}/backups/xpress/uploads/"
    else
        UPLOADS_ARCHIVE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
        tar -czf "$UPLOADS_ARCHIVE" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
        chmod 600 "$UPLOADS_ARCHIVE"
        log "uploads archived: $UPLOADS_ARCHIVE"
    fi
fi

# ── Off-box copy ──────────────────────────────────────────────
if [ -n "$S3_BUCKET" ]; then
    aws s3 cp "$DUMP" "s3://${S3_BUCKET}/backups/xpress/db/$(basename "$DUMP")" --sse AES256 --only-show-errors
    log "database dump uploaded to s3://${S3_BUCKET}/backups/xpress/db/"
else
    log "WARNING: S3_BACKUP_BUCKET is not set — this backup exists ONLY on this server."
    log "WARNING: if the server is lost, so is every backup. Set it in /etc/xpress-backup.conf."
    if [ "${REQUIRE_OFFSITE:-0}" = "1" ]; then
        exit 1
    fi
fi

# ── Local retention ───────────────────────────────────────────
find "$BACKUP_DIR" \( -name "*.dump" -o -name "*.sql.gz" -o -name "uploads_*.tar.gz" -o -name "*.partial" \) \
    -mtime +"$KEEP_LOCAL_DAYS" -delete
log "done"
