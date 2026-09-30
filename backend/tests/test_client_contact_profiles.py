"""Client identity, complete history, safe migration and directory integration."""
from datetime import date, datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database import Base
import app.models  # noqa: F401
from app.models.contact import Contact, ContactOrganization, Organization
from app.models.loan_application import LoanApplication, LoanType, ApplicationStatus
from app.models.loan_applicant import LoanApplicant
from app.models.lending_history_entry import LendingHistoryEntry
from app.models.settled_deal_snapshot import SettledDealSnapshot
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.services.client_identity import reconcile_clients, reconcile_application_links
from app.services.contact_history import contact_applications, snapshot_parties
from app.services.dedupe import merge_contacts
from app.routers.contacts import get_contact, list_contacts, update_contact
from app.schemas.contact import ContactDetailOut, ContactUpdate


@pytest.fixture
def db():
    engine = create_engine('sqlite://')
    @event.listens_for(engine, 'connect')
    def foreign_keys(conn, _record):
        conn.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, autoflush=False)() as session:
        tenant = Tenant(id='tenant', name='Test', slug='test')
        other = Tenant(id='other', name='Other', slug='other')
        session.add_all([tenant, other])
        session.commit()
        yield session
    engine.dispose()


def client(db, email='alex@example.test', name='Alex Citizen', tenant='tenant'):
    user = User(tenant_id=tenant, email=email, full_name=name, role=UserRole.client)
    db.add(user)
    db.flush()
    return user


def contact(db, first='Alex', last='Citizen', email='alex@example.test', tenant='tenant'):
    person = Contact(tenant_id=tenant, first_name=first, last_name=last, email=email)
    db.add(person)
    db.flush()
    return person


def application(db, owner, person=None, **kw):
    app = LoanApplication(tenant_id=owner.tenant_id, user_id=owner.id, contact_id=person.id if person else None,
                          loan_type=LoanType.vehicle, amount=25000, **kw)
    db.add(app)
    db.flush()
    return app


def listing(db, view='all', search=None):
    return list_contacts(page=1, per_page=100, search=search, view=view, include_organizations=True,
                         include_client_account=True, db=db, _current_user=None, tenant_id='tenant')


def test_registration_links_once_with_foreign_keys_and_email_changes(db):
    person = contact(db)
    user = client(db)
    assert user.contact_id == person.id
    user.email = 'new@example.test'
    db.commit()
    assert user.contact_id == person.id
    assert person.email == 'new@example.test'
    assert reconcile_clients(db)['accounts_linked'] == 0
    assert db.query(Contact).count() == 1
    detail = get_contact(person.id, db, None, 'tenant')
    assert ContactDetailOut.model_validate(detail).client_account.email == 'new@example.test'


def test_new_and_ambiguous_accounts_have_reviewable_profiles(db):
    one = contact(db)
    two = contact(db)
    user = client(db)
    assert user.contact_id not in (one.id, two.id)
    assert user.contact.needs_identity_review
    assert listing(db, 'review').total == 1
    assert listing(db, 'portal').total == 1
    assert listing(db, 'no_portal').total == 2
    assert listing(db, 'portal', 'Alex').total == 1
    staff = User(tenant_id='tenant', email='staff@example.test', full_name='Staff', role=UserRole.broker)
    db.add(staff)
    db.flush()
    assert staff.contact_id is None


def test_cross_tenant_email_does_not_link(db):
    other = contact(db, tenant='other')
    user = client(db)
    assert user.contact_id != other.id
    assert user.contact.tenant_id == 'tenant'
    with pytest.raises(HTTPException) as error:
        get_contact(other.id, db, None, 'tenant')
    assert error.value.status_code == 404


def test_profile_edits_sync_display_fields_without_changing_login(db):
    user = client(db)
    admin = User(tenant_id='tenant', email='admin@example.test', full_name='Admin', role=UserRole.admin)
    db.add(admin)
    db.flush()
    updated = update_contact(user.contact_id, ContactUpdate(first_name='Alicia', middle_name='Jo', phone='0400000000', email='correspondence@example.test'), db, admin, 'tenant')
    assert user.full_name == 'Alicia Jo Citizen'
    assert user.phone == '0400000000'
    assert user.email == 'alex@example.test'
    assert updated['middle_name'] == 'Jo'
    assert updated['client_account']['email'] == user.email


def test_history_includes_all_roles_once_and_excludes_unrelated_company_loans(db):
    user = client(db)
    person = user.contact
    primary = application(db, user, person)
    db.add(LoanApplicant(tenant_id='tenant', application_id=primary.id, contact_id=person.id, role='director'))
    someone = contact(db, first='Other', email='other@example.test')
    additional = application(db, user, someone)
    db.add(LoanApplicant(tenant_id='tenant', application_id=additional.id, contact_id=person.id, role='guarantor'))
    org = Organization(tenant_id='tenant', name='Example Business')
    db.add(org)
    db.flush()
    db.add(ContactOrganization(tenant_id='tenant', contact_id=person.id, organization_id=org.id, role='director'))
    unrelated = application(db, user, someone, business_organization_id=org.id)
    deleted = application(db, user, person, deleted_at=datetime.now(timezone.utc))
    db.commit()
    history = contact_applications(db, person.id, 'tenant')
    assert {r['id'] for r in history} == {primary.id, additional.id}
    assert len(history) == 2
    assert set(next(r['roles'] for r in history if r['id'] == primary.id)) == {'Main applicant', 'Director'}
    assert unrelated.id not in {r['id'] for r in history}
    assert deleted.id not in {r['id'] for r in history}
    assert next(c.application_count for c in listing(db, 'applications').items if c.id == person.id) == 2


def test_legacy_blank_account_draft_is_labelled_without_claiming_borrower(db):
    user = client(db)
    blank = application(db, user)
    named_other = application(db, user, applicant_first_name='Another', applicant_last_name='Person')
    company = application(db, user, applicant_type='company')
    db.commit()
    records = contact_applications(db, user.contact_id, 'tenant')
    assert [r['id'] for r in records] == [blank.id]
    assert records[0]['roles'] == ['Portal account']
    assert named_other.id != blank.id and company.id != blank.id


def test_settlement_survives_application_purge_and_contact_merge(db):
    user = client(db)
    duplicate = contact(db, email='old@example.test')
    app = application(db, user, duplicate, status=ApplicationStatus.settled, settled_at=datetime.now(timezone.utc))
    db.add(LoanApplicant(tenant_id='tenant', application_id=app.id, contact_id=user.contact_id, role='director'))
    snap = SettledDealSnapshot(tenant_id='tenant', application_id=app.id, snapshot_month=date.today().replace(day=1),
                               loan_type='vehicle', amount=25000, settled_at=app.settled_at)
    db.add(snap)
    snapshot_parties(db, app)
    db.commit()
    assert len(contact_applications(db, duplicate.id, 'tenant')) == 1
    app_id = app.id
    db.delete(app)
    db.commit()
    merge_contacts(db, user.contact, [duplicate])
    db.commit()
    history = contact_applications(db, user.contact_id, 'tenant')
    assert len(history) == 1
    assert history[0]['id'] == app_id
    assert history[0]['source'] == 'settlement'
    assert history[0]['can_open'] is False
    assert set(history[0]['roles']) == {'Main applicant', 'Director'}
    assert listing(db, 'applications').items[0].application_count == 1


def test_merge_moves_accounts_and_blocks_two_live_logins(db):
    user = client(db)
    original_id = user.contact_id
    keep = contact(db, email='keep@example.test')
    merge_contacts(db, keep, [user.contact])
    db.commit()
    assert user.contact_id == keep.id
    assert db.get(Contact, original_id) is None
    second = client(db, email='second@example.test', name='Second Person')
    with pytest.raises(HTTPException) as error:
        merge_contacts(db, keep, [second.contact])
    assert error.value.status_code == 409
    assert second.contact_id != keep.id


def test_manual_guarantees_and_deleted_accounts_preserve_history(db):
    user = client(db)
    borrower = contact(db, first='Borrower', email='borrower@example.test')
    db.add(LendingHistoryEntry(tenant_id='tenant', contact_id=borrower.id, guaranteed_by_contact_id=user.contact_id,
                              lender_name='Test lender', amount=10000))
    db.commit()
    saved_id = user.contact_id
    user.deleted_at = datetime.now(timezone.utc)
    user.email = f'{uuid4()}@deleted.invalid'
    user.full_name = 'Deleted user'
    user.phone = None
    db.commit()
    detail = get_contact(saved_id, db, None, 'tenant')
    assert detail['first_name'] == 'Alex'
    assert detail['client_account'] is None
    assert len(detail['lending_history']) == 1
    assert listing(db, 'no_portal').total == 2


def test_migration_links_only_corroborated_applicants_and_is_idempotent(db):
    user = client(db)
    good = application(db, user, applicant_first_name='Alex', applicant_last_name='Citizen', applicant_email=user.email)
    ambiguous = application(db, user, applicant_first_name='Alex', applicant_last_name='Citizen')
    other = application(db, user, applicant_first_name='Other', applicant_last_name='Person', applicant_email=user.email)
    report = reconcile_application_links(db)
    assert report['applications_linked'] == 1
    assert good.contact_id == user.contact_id
    assert ambiguous.contact_id is None and other.contact_id is None
    assert reconcile_application_links(db)['applications_linked'] == 0


def test_application_contact_resolution_prefers_permanent_link(db):
    from app.services.contacts import ensure_contact
    contact(db)
    contact(db)
    user = client(db)
    person = ensure_contact(db, 'tenant', 'Alex', 'Citizen', email=user.email)
    assert person.id == user.contact_id
    other = ensure_contact(db, 'tenant', 'Different', 'Person', email=user.email)
    assert other.id != person.id
    assert other.needs_identity_review


def test_explicit_profile_invite_and_start_application(db, monkeypatch):
    from app.routers import invitations
    from app.schemas.user import InvitationCreate, StartApplicationForClient
    monkeypatch.setattr(invitations, 'send_setup_account_email', lambda *args, **kw: None)
    monkeypatch.setattr(invitations, 'notify_admins_new_account', lambda *args, **kw: None)
    monkeypatch.setattr(invitations, 'send_complete_application_email', lambda *args, **kw: None)
    admin = User(tenant_id='tenant', email='admin@example.com', full_name='Admin', role=UserRole.admin)
    db.add(admin)
    person = contact(db, email='alex@example.com')
    account = invitations.invite_user(InvitationCreate(contact_id=person.id, email=person.email, full_name='Alex Citizen'), db, admin, 'tenant')
    assert account.contact_id == person.id
    result = invitations.start_application_for_client(StartApplicationForClient(client_id=account.id, loan_type='vehicle', amount=10000), db, admin, 'tenant')
    started = db.get(LoanApplication, result['application_id'])
    assert started.contact_id == person.id
    assert started.applicant_first_name == 'Alex'
    other = contact(db, email='different@example.com')
    with pytest.raises(HTTPException) as error:
        invitations.invite_user(InvitationCreate(contact_id=other.id, email=account.email, full_name='Different Person'), db, admin, 'tenant')
    assert error.value.status_code == 409


def test_old_database_migration_is_repeatable(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path
    from sqlalchemy import MetaData, Table, insert

    legacy = MetaData()
    removed = {'users': {'contact_id'}, 'contacts': {'needs_identity_review'}, 'settled_deal_snapshots': {'settled_at'}}
    for table in Base.metadata.tables.values():
        if table.name in removed:
            Table(table.name, legacy, *(column._copy() for column in table.columns if column.name not in removed[table.name]))
        elif table.name != 'settled_deal_parties':
            table.to_metadata(legacy)
    path = tmp_path / 'legacy.db'
    engine = create_engine(f'sqlite:///{path}')
    legacy.create_all(engine)
    with engine.begin() as conn:
        conn.execute(insert(legacy.tables['tenants']).values(id='legacy', name='Legacy', slug='legacy'))
        conn.execute(insert(legacy.tables['users']).values(id='client', tenant_id='legacy', email='legacy@example.com', full_name='Legacy Client', role='client'))
    engine.dispose()
    env = dict(os.environ, DATABASE_URL=f'sqlite:///{path}', ENVIRONMENT='development', SES_FROM_EMAIL='')
    code = '''from app.main import app
from app.database import SessionLocal
from app.models.user import User
from app.models.contact import Contact
with SessionLocal() as db:
    user = db.get(User, "client")
    assert user.contact_id
    assert db.query(Contact).filter(Contact.tenant_id == "legacy").count() == 1
    print(user.contact_id)
'''
    ids = []
    for _ in range(2):
        run = subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).parents[1], env=env, text=True, capture_output=True)
        assert run.returncode == 0, run.stderr
        ids.append(run.stdout.strip())
    assert ids[0] == ids[1]
