"""per-application referrers with history

Revision ID: c4e7a91f2b6d
Revises: bd0aded7a7ea
Create Date: 2026-11-22 22:00:00

Each application now carries its own referrer (loan_applications.referrer_id)
instead of inheriting the client's, and every credit is recorded in
application_referrer_changes. Existing applications are credited with exactly
the referrer the app showed before this revision, so nothing visibly changes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op


revision: str = 'c4e7a91f2b6d'
down_revision: str | None = 'bd0aded7a7ea'
branch_labels = None
depends_on = None

BACKFILL_NOTE = "Credited from the client's referrer when per-application referrers went live"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {i["name"] for i in _inspector().get_indexes(table)}


def upgrade() -> None:
    # A pre-Alembic database reaches the baseline through the frozen legacy
    # path, whose create_all uses today's models, and some dev databases kept
    # an unused referrer_id column from an earlier attempt — so create only
    # what is missing, and let the backfill below overwrite any old values.
    if not _has_column('loan_applications', 'referrer_id'):
        with op.batch_alter_table('loan_applications', schema=None) as batch_op:
            batch_op.add_column(sa.Column('referrer_id', sa.String(length=36), nullable=True))
            batch_op.create_foreign_key('fk_loan_applications_referrer_id_users', 'users', ['referrer_id'], ['id'],
                                        ondelete='SET NULL')
    if not _has_index('loan_applications', 'ix_loan_applications_referrer_id'):
        with op.batch_alter_table('loan_applications', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_loan_applications_referrer_id'), ['referrer_id'], unique=False)

    created_history = False
    if not _has_table('application_referrer_changes'):
        op.create_table('application_referrer_changes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tenant_id', sa.String(length=36), nullable=True),
        sa.Column('application_id', sa.String(length=36), nullable=False),
        sa.Column('from_referrer_id', sa.String(length=36), nullable=True),
        sa.Column('to_referrer_id', sa.String(length=36), nullable=True),
        sa.Column('changed_by_id', sa.String(length=36), nullable=True),
        sa.Column('source', sa.String(length=20), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['application_id'], ['loan_applications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['changed_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['from_referrer_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['to_referrer_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('application_referrer_changes', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_application_referrer_changes_application_id'), ['application_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_application_referrer_changes_tenant_id'), ['tenant_id'], unique=False)
        created_history = True

    _backfill(write_history=created_history)


def _backfill(write_history: bool) -> None:
    """Credit each application with the referrer it showed until now, in the
    same order the app resolved it: the owner when a referrer submitted it; the
    owner's ExternalReferral (earliest); a Referral whose referrer has the
    referrer role (admin/broker invite links also write Referral rows); else the
    referrer on the lead it was converted from."""
    bind = op.get_bind()
    referrer_users = {r[0] for r in bind.execute(sa.text("SELECT id FROM users WHERE role = 'referrer'"))}

    by_external: dict[str, str] = {}
    for client_id, referrer_id in bind.execute(sa.text(
        "SELECT referred_client_id, referrer_id FROM external_referrals "
        "WHERE referred_client_id IS NOT NULL ORDER BY created_at"
    )):
        by_external.setdefault(client_id, referrer_id)

    by_referral: dict[str, str] = {}
    for user_id, referrer_id in bind.execute(sa.text(
        "SELECT referred_user_id, referrer_id FROM referrals "
        "WHERE referred_user_id IS NOT NULL ORDER BY created_at"
    )):
        if referrer_id in referrer_users:
            by_referral.setdefault(user_id, referrer_id)

    by_lead: dict[str, str] = {}
    for app_id, referrer_id in bind.execute(sa.text(
        "SELECT converted_application_id, referrer_id FROM leads "
        "WHERE converted_application_id IS NOT NULL AND referrer_id IS NOT NULL ORDER BY created_at"
    )):
        by_lead.setdefault(app_id, referrer_id)

    apps = bind.execute(sa.text("SELECT id, tenant_id, user_id, created_at FROM loan_applications")).fetchall()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for app_id, tenant_id, user_id, created_at in apps:
        if user_id in referrer_users:
            referrer_id = user_id
        else:
            referrer_id = by_external.get(user_id) or by_referral.get(user_id) or by_lead.get(app_id)
        bind.execute(sa.text("UPDATE loan_applications SET referrer_id = :r WHERE id = :id"),
                     {"r": referrer_id, "id": app_id})
        if referrer_id and write_history:
            bind.execute(sa.text(
                "INSERT INTO application_referrer_changes "
                "(id, tenant_id, application_id, from_referrer_id, to_referrer_id, changed_by_id, source, note, created_at) "
                "VALUES (:id, :tenant_id, :app_id, NULL, :r, NULL, 'backfill', :note, :at)"
            ), {"id": str(uuid.uuid4()), "tenant_id": tenant_id, "app_id": app_id, "r": referrer_id,
                "note": BACKFILL_NOTE, "at": created_at or now})


def downgrade() -> None:
    with op.batch_alter_table('application_referrer_changes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_application_referrer_changes_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_application_referrer_changes_application_id'))
    op.drop_table('application_referrer_changes')
    with op.batch_alter_table('loan_applications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_loan_applications_referrer_id'))
        batch_op.drop_constraint('fk_loan_applications_referrer_id_users', type_='foreignkey')
        batch_op.drop_column('referrer_id')
