#!/bin/bash
# =============================================================
# Xpress Tech Portal — restore drill
#
# A backup nobody has restored is a hope, not a backup. This restores the
# newest dump into a scratch database, checks it is whole, proves the
# encryption key on this server still opens the PII in it, and drops the
# scratch database again. The live database is never touched.
#
# Usage:  sudo ./deploy/restore-test.sh [path/to/file.dump]
#         (no argument: newest dump in /opt/backups/xpress, or newest in the
#          S3 bucket when --from-s3 is given)
# Run it monthly, and after any change to backups or the key ring.
# Exit status 0 = the backup is restorable AND readable.
# =============================================================
set -euo pipefail

[ -f /etc/xpress-backup.conf ] && . /etc/xpress-backup.conf

APP_DIR="${APP_DIR:-/opt/xpress-tech-portal}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/xpress}"
DB_NAME="${DB_NAME:-xpresstech}"
SCRATCH_DB="${DB_NAME}_restore_test"
S3_BUCKET="${S3_BACKUP_BUCKET:-}"
PG_SUDO="${PG_SUDO-sudo -u postgres}"
ENV_FILE="${ENV_FILE:-$APP_DIR/backend/.env}"
PYTHON="${PYTHON:-$APP_DIR/backend/venv/bin/python3}"

log()  { echo "restore-test: $*"; }
fail() { echo "restore-test: FAILED — $*" >&2; exit 1; }

DUMP="${1:-}"
if [ "$DUMP" = "--from-s3" ]; then
    [ -n "$S3_BUCKET" ] || fail "--from-s3 needs S3_BACKUP_BUCKET in /etc/xpress-backup.conf"
    KEY=$(aws s3 ls "s3://${S3_BUCKET}/backups/xpress/db/" | sort | tail -1 | awk '{print $4}')
    [ -n "$KEY" ] || fail "no dumps in s3://${S3_BUCKET}/backups/xpress/db/"
    DUMP="$(mktemp -d)/$KEY"
    aws s3 cp "s3://${S3_BUCKET}/backups/xpress/db/$KEY" "$DUMP" --only-show-errors
    log "downloaded $KEY from S3"
elif [ -z "$DUMP" ]; then
    DUMP=$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1 || true)
fi
[ -n "$DUMP" ] && [ -f "$DUMP" ] || fail "no dump file found (looked in $BACKUP_DIR)"
log "using $DUMP ($(du -h "$DUMP" | cut -f1))"

AGE_HOURS=$(( ( $(date +%s) - $(date -r "$DUMP" +%s) ) / 3600 ))
[ "$AGE_HOURS" -le 48 ] || log "WARNING: newest dump is ${AGE_HOURS}h old — is the daily backup running?"

psql_scratch() { $PG_SUDO psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$SCRATCH_DB" -c "$1"; }
cleanup() { $PG_SUDO dropdb --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
$PG_SUDO createdb "$SCRATCH_DB"
# --no-owner/--no-privileges: the scratch copy only has to be readable here.
$PG_SUDO pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH_DB" < "$DUMP"
log "restored into $SCRATCH_DB"

TABLES=$(psql_scratch "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
USERS=$(psql_scratch "SELECT count(*) FROM users")
APPS=$(psql_scratch "SELECT count(*) FROM loan_applications")
DOCS=$(psql_scratch "SELECT count(*) FROM documents")
REVISION=$(psql_scratch "SELECT version_num FROM alembic_version" 2>/dev/null || echo "none (pre-Alembic dump)")
log "tables=$TABLES users=$USERS applications=$APPS documents=$DOCS schema=$REVISION"
[ "$TABLES" -gt 20 ] || fail "only $TABLES tables restored"
[ "$USERS" -gt 0 ]   || fail "users table is empty"

# ── Can the key on this server read the PII in the backup? ────
# Pull one encrypted value per column and decrypt it with the configured ring.
SAMPLES=$(mktemp)
for PAIR in loan_applications.applicant_first_name loan_applications.lend_extra_data documents.ocr_text contacts.first_name users.bank_account_number; do
    TBL="${PAIR%%.*}"; COL="${PAIR##*.}"
    psql_scratch "SELECT $COL FROM $TBL WHERE $COL LIKE 'gAAAAA%' LIMIT 1" >> "$SAMPLES" 2>/dev/null || true
done
if [ ! -s "$SAMPLES" ]; then
    log "WARNING: no encrypted values found to test the key against (empty database?)"
else
    KEY_RING=$(grep -E '^FIELD_ENCRYPTION_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')
    [ -n "$KEY_RING" ] || fail "FIELD_ENCRYPTION_KEY not found in $ENV_FILE"
    FIELD_ENCRYPTION_KEY="$KEY_RING" "$PYTHON" - "$SAMPLES" <<'PY' || fail "the encryption key on this server cannot decrypt the backup's PII"
import os, sys
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

ring = MultiFernet([Fernet(k.strip().encode()) for k in os.environ["FIELD_ENCRYPTION_KEY"].split(",") if k.strip()])
tokens = [line.strip() for line in open(sys.argv[1]) if line.strip()]
for token in tokens:
    try:
        ring.decrypt(token.encode())
    except InvalidToken:
        sys.exit(1)
print(f"restore-test: decrypted {len(tokens)} encrypted sample(s) with the configured key ring")
PY
fi
rm -f "$SAMPLES"

log "OK — backup is restorable and readable. Scratch database dropped."
