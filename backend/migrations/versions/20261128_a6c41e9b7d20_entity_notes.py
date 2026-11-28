"""entity notes

Revision ID: a6c41e9b7d20
Revises: f3a9d2c61e58
Create Date: 2026-11-28 18:00:00

A dated, authored notes feed for each entity, replacing the single free-text
organizations.notes field in the app. Each entity's existing text is carried
over as a pinned "general" note with no author; the old column is left as it
was.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op


revision: str = 'a6c41e9b7d20'
down_revision: str | None = 'f3a9d2c61e58'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # The frozen legacy path's create_all uses today's models, so the table may
    # already be there (then empty — fill it all the same).
    if 'entity_notes' not in sa.inspect(bind).get_table_names():
        op.create_table(
            'entity_notes',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('tenant_id', sa.String(length=36), nullable=True),
            sa.Column('organization_id', sa.String(length=36), nullable=False),
            sa.Column('author_id', sa.String(length=36), nullable=True),
            sa.Column('category', sa.String(length=20), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('is_pinned', sa.Boolean(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.Column('updated_by_id', sa.String(length=36), nullable=True),
            sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
            sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        with op.batch_alter_table('entity_notes', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_entity_notes_organization_id'), ['organization_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_entity_notes_tenant_id'), ['tenant_id'], unique=False)

    already = {r[0] for r in bind.execute(sa.text("SELECT DISTINCT organization_id FROM entity_notes"))}
    orgs = sa.table(
        'organizations',
        sa.column('id', sa.String), sa.column('tenant_id', sa.String), sa.column('notes', sa.Text),
        sa.column('updated_at', sa.DateTime), sa.column('created_at', sa.DateTime),
    )
    rows = [r for r in bind.execute(sa.select(orgs).where(orgs.c.notes.isnot(None))) if (r.notes or "").strip()]
    notes = sa.table(
        'entity_notes',
        sa.column('id', sa.String), sa.column('tenant_id', sa.String), sa.column('organization_id', sa.String),
        sa.column('author_id', sa.String), sa.column('category', sa.String), sa.column('content', sa.Text),
        sa.column('is_pinned', sa.Boolean), sa.column('created_at', sa.DateTime),
    )
    carried = [
        {"id": str(uuid.uuid4()), "tenant_id": r.tenant_id, "organization_id": r.id, "author_id": None,
         "category": "general", "content": r.notes.strip(), "is_pinned": True,
         "created_at": r.updated_at or r.created_at or datetime.now(timezone.utc).replace(tzinfo=None)}
        for r in rows if r.id not in already
    ]
    if carried:
        op.bulk_insert(notes, carried)


def downgrade() -> None:
    with op.batch_alter_table('entity_notes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_entity_notes_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_entity_notes_organization_id'))
    op.drop_table('entity_notes')
