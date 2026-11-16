"""The schema is owned by Alembic: the models and the migrations must agree."""
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext

from app.database import Base, engine
from app.migrate import current_revision, head_revision, schema_is_current


def test_database_is_at_head():
    assert current_revision() == head_revision()
    assert schema_is_current()


def test_models_match_migrations():
    """A model change without a migration fails here, not in production.

    Fix: alembic revision --autogenerate -m "describe the change"
    """
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert not diff, f"Models differ from the migrated schema — write a migration: {diff}"


def test_importing_the_app_does_not_touch_the_schema(tmp_path):
    """app.main used to run create_all and hundreds of ALTERs at import."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "untouched.db"
    env = dict(os.environ, DATABASE_URL=f"sqlite:///{db}", ENVIRONMENT="development", SES_FROM_EMAIL="")
    code = (
        "import app.main\n"
        "from sqlalchemy import inspect\n"
        "from app.database import engine\n"
        "print(len(inspect(engine).get_table_names()))\n"
    )
    run = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parents[1], env=env, text=True, capture_output=True)
    assert run.returncode == 0, run.stderr
    assert run.stdout.strip().splitlines()[-1] == "0"


def test_production_refuses_to_start_on_a_stale_schema(monkeypatch):
    import pytest

    import app.startup as startup

    monkeypatch.setattr(startup, "AUTO_MIGRATE", False)
    monkeypatch.setattr("app.migrate.head_revision", lambda: "9999_future")
    with pytest.raises(RuntimeError, match="python -m app.migrate"):
        startup.ensure_schema()
