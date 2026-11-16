"""Test bootstrap.

app.config fails closed in production mode (default), so force development
before anything under ``app`` is imported. Tests never touch the real app.db:
DATABASE_URL points at a throwaway SQLite file, built here by the same Alembic
path a deploy uses (`python -m app.migrate`), so the suite also proves the
migrations produce a schema the app can run on.
"""
import os

os.environ.setdefault("ENVIRONMENT", "development")
import tempfile

_TEST_DB = tempfile.NamedTemporaryFile(prefix="xpress-test-", suffix=".db", delete=False)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TEST_DB.name}")

from app.migrate import migrate  # noqa: E402

migrate()
