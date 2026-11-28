"""application clawbacks

Revision ID: e81b5c3d9a47
Revises: c4e7a91f2b6d
Create Date: 2026-11-28 10:00:00

Brokerage clawed back on a settled loan, recorded against the application by
the team. Each raises a client alert and shows in the private ledger in the
month of the clawback.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = 'e81b5c3d9a47'
down_revision: str | None = 'c4e7a91f2b6d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The frozen legacy path's create_all uses today's models, so a database
    # upgraded through it may already have the table.
    if 'application_clawbacks' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'application_clawbacks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tenant_id', sa.String(length=36), nullable=True),
        sa.Column('application_id', sa.String(length=36), nullable=False),
        sa.Column('clawback_date', sa.Date(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('client_alert_id', sa.String(length=36), nullable=True),
        sa.Column('created_by_id', sa.String(length=36), nullable=True),
        sa.Column('updated_by_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['application_id'], ['loan_applications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['client_alert_id'], ['client_alerts.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('application_clawbacks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_application_clawbacks_application_id'), ['application_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_application_clawbacks_clawback_date'), ['clawback_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_application_clawbacks_tenant_id'), ['tenant_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('application_clawbacks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_application_clawbacks_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_application_clawbacks_clawback_date'))
        batch_op.drop_index(batch_op.f('ix_application_clawbacks_application_id'))
    op.drop_table('application_clawbacks')
