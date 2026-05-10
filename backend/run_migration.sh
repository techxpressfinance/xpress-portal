#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python3"
MIGRATION="$SCRIPT_DIR/migrate_sqlite_to_pg.py"
SQLITE="$SCRIPT_DIR/app.db"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

# Export all vars from .env
set -a
source "$ENV_FILE"
set +a

export SQLITE_PATH="$SQLITE"

echo "Running migration..."
echo "  SQLite: $SQLITE_PATH"
echo "  Postgres: $DATABASE_URL"
echo ""

"$VENV_PYTHON" "$MIGRATION"
