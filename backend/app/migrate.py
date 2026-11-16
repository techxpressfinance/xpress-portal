"""Bring the database schema to the current Alembic head.

    python -m app.migrate            # upgrade now (the server also does this at startup)
    python -m app.migrate --check    # exit 1 if the schema is behind

Three starting points, one command:

* empty database        -> the baseline revision builds the whole schema
* pre-Alembic database  -> the frozen legacy upgrade runs ONCE to reach the
                           baseline schema, the database is stamped there, then
                           any later revisions apply
* Alembic-managed       -> pending revisions apply

Each revision runs once and is recorded in ``alembic_version``. The server
calls migrate() when it starts (AUTO_MIGRATE, on by default); see app/startup.py.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect

from app.database import engine

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE_REVISION = "0001_baseline"


def alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


def current_revision() -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def head_revision() -> str | None:
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def schema_is_current() -> bool:
    return current_revision() == head_revision()


def migrate() -> None:
    cfg = alembic_config()
    if current_revision() is None and "users" in inspect(engine).get_table_names():
        # A database from before Alembic. Its last boot may predate columns the
        # baseline expects, so finish the old upgrade path one final time.
        from app.legacy_migrations import run_legacy_migrations

        logger.info("Pre-Alembic database: running the legacy upgrade once, then stamping %s", BASELINE_REVISION)
        run_legacy_migrations()
        command.stamp(cfg, BASELINE_REVISION)
    command.upgrade(cfg, "head")
    logger.info("Database schema is at %s", current_revision())


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(name)s: %(message)s")
    if "--check" in argv:
        current, head = current_revision(), head_revision()
        if current == head:
            print(f"Schema is current ({head}).")
            return 0
        print(f"Schema is at {current or 'no revision'}; head is {head}. Run: python -m app.migrate")
        return 1
    migrate()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
