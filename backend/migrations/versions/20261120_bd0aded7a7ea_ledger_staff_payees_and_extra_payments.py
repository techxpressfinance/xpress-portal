"""ledger staff payees and extra payments

Revision ID: bd0aded7a7ea
Revises: 0001_baseline
Create Date: 2026-11-20 00:33:53.422488
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = 'bd0aded7a7ea'
down_revision: str | None = '0001_baseline'
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # A pre-Alembic database is brought to the baseline by the frozen legacy
    # path, whose create_all uses today's models — so on one of those the table
    # and column may already be here. Create only what is missing.
    if not _has_table('ledger_payments'):
        _create_payments()
    if not _has_column('ledger_payees', 'kind'):
        with op.batch_alter_table('ledger_payees', schema=None) as batch_op:
            batch_op.add_column(sa.Column('kind', sa.String(length=20), server_default='referrer', nullable=False))


def _create_payments() -> None:
    op.create_table('ledger_payments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('tenant_id', sa.String(length=36), nullable=False),
    sa.Column('payee_id', sa.String(length=36), nullable=False),
    sa.Column('payment_date', sa.Date(), nullable=False),
    sa.Column('category', sa.String(length=20), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('gst', sa.Boolean(), nullable=True),
    sa.Column('deal_key', sa.String(length=36), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('scheduled_on', sa.Date(), nullable=True),
    sa.Column('paid_on', sa.Date(), nullable=True),
    sa.Column('payment_method', sa.String(length=50), nullable=True),
    sa.Column('payment_reference', sa.String(length=200), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_by_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('ledger_payments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_ledger_payments_payee_id'), ['payee_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_ledger_payments_payment_date'), ['payment_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_ledger_payments_tenant_id'), ['tenant_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('ledger_payees', schema=None) as batch_op:
        batch_op.drop_column('kind')

    with op.batch_alter_table('ledger_payments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_ledger_payments_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_ledger_payments_payment_date'))
        batch_op.drop_index(batch_op.f('ix_ledger_payments_payee_id'))

    op.drop_table('ledger_payments')
