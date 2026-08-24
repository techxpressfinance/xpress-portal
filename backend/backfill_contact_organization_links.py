"""Backfill Contact↔Organization links from existing applications.

An application that carries both a client (contact_id) and a business entity
(business_organization_id) should have a ContactOrganization row linking the
two. That link is now created automatically on create/update/clone; this script
retro-fits applications that existed before that change.

Run on EC2 from the backend/ directory with the venv active so DATABASE_URL
from .env points at the RDS Postgres instance:

    source venv/bin/activate
    python3 backfill_contact_organization_links.py
"""
from __future__ import annotations

from app.database import SessionLocal
# Import every model so SQLAlchemy can resolve the full relationship graph when
# configuring mappers (same set main.py imports at startup).
from app.models.application_broker import ApplicationBroker  # noqa: F401
from app.models.application_calculator import ApplicationCalculator  # noqa: F401
from app.models.application_note import ApplicationNote  # noqa: F401
from app.models.broker_group import BrokerGroup, broker_group_members  # noqa: F401
from app.models.client_alert import ClientAlert  # noqa: F401
from app.models.client_message import ClientMessage  # noqa: F401
from app.models.contact import Contact, ContactOrganization, Organization  # noqa: F401
from app.models.document import Document  # noqa: F401
from app.models.document_request import DocumentRequest  # noqa: F401
from app.models.external_referral import ExternalReferral  # noqa: F401
from app.models.kanban import KanbanBoard, KanbanColumn  # noqa: F401
from app.models.lender import Lender, LenderContact  # noqa: F401
from app.models.lender_submission import LenderSubmission  # noqa: F401
from app.models.lending_history_entry import LendingHistoryEntry  # noqa: F401
from app.models.loan_applicant import ApplicationGuarantor, LoanApplicant  # noqa: F401
from app.models.loan_application import LoanApplication  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.quote_sheet import QuoteSheet, QuoteOption  # noqa: F401
from app.models.referral import Referral  # noqa: F401
from app.models.service_request import ServiceRequest  # noqa: F401
from app.models.service_request_attachment import ServiceRequestAttachment  # noqa: F401
from app.models.service_request_checklist import ServiceRequestChecklistItem  # noqa: F401
from app.models.settled_deal_snapshot import SettledDealSnapshot  # noqa: F401
from app.models.task import Task, ChecklistItem  # noqa: F401
from app.models.task_attachment import TaskAttachment  # noqa: F401
from app.models.tenant import Tenant  # noqa: F401
from app.models.token_blacklist import TokenBlacklist  # noqa: F401
from app.models.trust_party import TrustParty  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.arrears import (  # noqa: F401
    ArrearsAttachment,
    ArrearsContactAttempt,
    ArrearsEvent,
    ArrearsRecord,
    ArrearsRecordLender,
    ArrearsSnapshot,
)
from app.services.organizations import ensure_contact_organization_link


def main() -> None:
    db = SessionLocal()
    try:
        apps = (
            db.query(LoanApplication)
            .filter(
                LoanApplication.deleted_at.is_(None),
                LoanApplication.contact_id.isnot(None),
                LoanApplication.business_organization_id.isnot(None),
            )
            .all()
        )

        # Unique (tenant, contact, organization) pairs across all matching apps.
        pairs = {(a.tenant_id, a.contact_id, a.business_organization_id) for a in apps}

        before = db.query(ContactOrganization).count()

        for tenant_id, contact_id, organization_id in sorted(pairs):
            ensure_contact_organization_link(db, tenant_id, contact_id, organization_id)

        db.commit()
        after = db.query(ContactOrganization).count()

        print(f"Applications scanned: {len(apps)}")
        print(f"Distinct client<->entity pairs: {len(pairs)}")
        print(f"Links created: {after - before}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
