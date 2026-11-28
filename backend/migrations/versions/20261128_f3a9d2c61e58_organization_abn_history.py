"""organization ABN history

Revision ID: f3a9d2c61e58
Revises: e81b5c3d9a47
Create Date: 2026-11-28 17:00:00

The register's history of an entity's ABN (names, status and GST periods,
trading and business names, state moves), kept on the entity once fetched.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = 'f3a9d2c61e58'
down_revision: str | None = 'e81b5c3d9a47'
branch_labels = None
depends_on = None

COLUMNS = (
    ('abr_history', sa.Text()),
    ('abr_history_abn', sa.String(length=20)),
    ('abr_history_checked_at', sa.DateTime()),
)


def upgrade() -> None:
    # The frozen legacy path's create_all uses today's models, so the columns
    # may already be there.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns('organizations')}
    missing = [(name, type_) for name, type_ in COLUMNS if name not in have]
    if not missing:
        return
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        for name, type_ in missing:
            batch_op.add_column(sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        for name, _ in reversed(COLUMNS):
            batch_op.drop_column(name)
