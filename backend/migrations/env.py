"""Alembic environment: wires migrations to the app's engine and models."""
from __future__ import annotations

import sqlalchemy as sa
from alembic import context

import app.models  # noqa: F401 — registers every model on Base.metadata
from app.database import Base, engine
from app.models.encrypted_type import EncryptedString

target_metadata = Base.metadata


def _render_item(type_, obj, autogen_context):
    # EncryptedString is Text on disk; migrations must not import app code.
    if type_ == "type" and isinstance(obj, EncryptedString):
        return "sa.Text()"
    return False


def _include_object(obj, name, type_, reflected, compare_to):
    # Databases that predate Alembic carry a few hand-made indexes. Never let
    # autogenerate propose dropping an index just because no model declares it.
    if type_ == "index" and reflected and compare_to is None:
        return False
    # A few link tables declare a unique constraint over exactly their primary
    # key. Postgres folds the two together, so it would be re-proposed forever.
    if type_ == "unique_constraint" and not reflected:
        if {c.name for c in obj.columns} == {c.name for c in obj.table.primary_key.columns}:
            return False
    return True


def _compare_type(ctx, inspected_column, metadata_column, inspected_type, metadata_type):
    if isinstance(metadata_type, EncryptedString):
        return not isinstance(inspected_type, (sa.Text, sa.String))
    return None  # default comparison


def run_migrations_online() -> None:
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_item=_render_item,
            include_object=_include_object,
            compare_type=_compare_type,
            # SQLite cannot ALTER most things in place; batch mode rebuilds the
            # table. A no-op on Postgres.
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


def run_migrations_offline() -> None:
    context.configure(
        url=str(engine.url),
        target_metadata=target_metadata,
        render_item=_render_item,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
