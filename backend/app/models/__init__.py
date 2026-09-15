from app.models.tenant import Tenant
from app.models.user import User
from app.models.loan_application import LoanApplication
from app.models.loan_applicant import LoanApplicant
from app.models.document import Document
from app.models.activity_log import ActivityLog
from app.models.application_note import ApplicationNote
from app.models.direct_message import DirectMessage
from app.models.referral import Referral
from app.models.kanban import KanbanBoard, KanbanColumn
from app.models.broker_group import BrokerGroup
from app.models.external_referral import ExternalReferral
from app.models.lender import Lender
from app.models.lender_submission import LenderSubmission
from app.models.task import Task, ChecklistItem
from app.models.quote_sheet import QuoteSheet, QuoteOption
from app.models.contact import Contact, Organization, ContactOrganization
from app.models.service_request import ServiceRequest
from app.models.service_request_broker import ServiceRequestBroker
from app.models.service_request_note import ServiceRequestNote
from app.models.service_request_order import ServiceRequestOrder
from app.models.service_request_checklist import ServiceRequestChecklistItem
from app.models.notification import Notification

__all__ = ["Tenant", "User", "LoanApplication", "LoanApplicant", "Document", "ActivityLog", "ApplicationNote", "DirectMessage", "Referral", "KanbanBoard", "KanbanColumn", "BrokerGroup", "ExternalReferral", "Lender", "LenderSubmission", "Task", "ChecklistItem", "QuoteSheet", "QuoteOption", "Contact", "Organization", "ContactOrganization", "ServiceRequest", "ServiceRequestBroker", "ServiceRequestNote", "ServiceRequestOrder", "ServiceRequestChecklistItem", "Notification"]


# SQLAlchemy resolves relationship() targets by class name across the whole
# registry, so touching ANY model needs every model imported — a query for a
# Tenant will fail on LoanApplication's reference to ApprovalCondition if that
# module was never loaded. The explicit list above is not complete, and main.py
# makes up the difference with a long import block of its own; anything that is
# not the app (create_admin.py, reset_password.py, seed_admin.py, one-off
# imports) has no such block and used to fall over.
#
# Walking the package here means the registry is whole for every entry point,
# and stays whole as models are added. Safe to do at the end of __init__: no
# model module imports this package, so there is no cycle to trip over.
def _load_all_models() -> None:
    import importlib
    import pkgutil

    for module in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{module.name}")


_load_all_models()
