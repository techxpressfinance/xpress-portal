"""Test bootstrap.

app.config fails closed in production mode (default), so force development
before anything under ``app`` is imported. Tests never touch the real app.db:
DATABASE_URL points at a throwaway SQLite file so importing app.main (which
runs create_all and the startup migrations) is safe.
"""
import os

os.environ.setdefault("ENVIRONMENT", "development")
import tempfile

_TEST_DB = tempfile.NamedTemporaryFile(prefix="xpress-test-", suffix=".db", delete=False)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TEST_DB.name}")
