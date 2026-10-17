"""Settlement checklists — what a broker ticks off before a deal moves on.

Each checklist serves a `purpose` (see models/settlement_checklist.py):

settlement_pack   — the pack that goes to the lender, in three kinds by deal,
                    transcribed from the desk's paper packs: the consumer deal
                    checklist and the settlement packs for a dealer sale and a
                    private sale.
lender_submission — the desk's checks before those docs go to the lender.
loan_settled      — what must be done when the loan settles.

The first two are asked by the asset-finance "Settlement Docs – Submitted to
Lender" stage (STAGE_ENTRY_CHECKLISTS in constants.py); the last by any move
into Settled, from the board or the status control — that check lives in
services/application_status.change_application_status, the one path every
status change takes. Items are code, not data; only a deal's answers are stored.

An item is answered when it is ticked, or marked N/A where it only sometimes
applies (insurance over $100k, a payout letter "if any"). A ticked item with
sub-items needs each of them ticked too, except sub-items that only apply to
some deals (the odometer on a used or demo vehicle), which may stay blank.

A checklist can also carry `follow_ups`: work that can't be done until after
the move (the amortisation schedule arrives days after settlement). They are
not ticked; entering the stage raises each as a task — see create_follow_up_tasks.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.loan_application import APPLICANT_TYPE_INDIVIDUAL, LoanApplication
from app.models.settlement_checklist import SettlementChecklist
from app.models.tax_invoice import SupplierType
from app.services.loan_category import CONSUMER_SUB_TYPES, application_sub_type
from app.services.tax_invoice import effective_sale_type


def _follow_up(key: str, title: str, note: Optional[str] = None, *, days_after: int = 3) -> dict:
    return {"key": key, "title": title, "note": note, "days_after": days_after}


def _item(key: str, label: str, note: Optional[str] = None, *, optional: bool = False, subs: Optional[list[dict]] = None) -> dict:
    return {"key": key, "label": label, "note": note, "optional": optional, "subs": subs or []}


def _sub(key: str, label: str, *, optional: bool = False) -> dict:
    return {"key": key, "label": label, "optional": optional}


_INSURANCE_NOTE = "Needed when the amount financed is over $100k for Capital and Westpac; for other lenders check the approval conditions."

CONSUMER = {
    "kind": "consumer",
    "title": "Checklist – Consumer Deal",
    "items": [
        _item("app_form", "Complete app form"),
        _item("consumer_quotes", "Pull consumer quotes"),
        _item("servicing", "Do servicing"),
        _item("finalise_quote", "Finalise quote"),
        _item("draft_portal", "Draft in portal"),
        _item("submit_application", "Submit application"),
        _item("post_approval_docs", "Prepare post-approval docs list"),
        _item("crm_compliance", "CRM & compliance"),
        _item("docs_to_client", "Send docs to client"),
        _item("broker_invoice", "Broker invoice"),
        _item("signed_docs", "Signed docs"),
        _item("settlement_confirmation", "Settlement confirmation"),
        _item("inform_client", "Inform client"),
    ],
}

DEALER_SALE = {
    "kind": "dealer_sale",
    "title": "Settlement Pack – Dealer Sale",
    "items": [
        _item("settlement_checklist", "Settlement checklist", subs=[
            _sub("client_name", "Client's name validated"),
            _sub("abn", "ABN"),
            _sub("deal_number", "Deal #"),
            _sub("insurer_name", "Insurer name", optional=True),
            _sub("policy_number", "Policy number", optional=True),
            _sub("policy_expiry", "Policy expiry", optional=True),
            _sub("page_no", "Page no"),
            _sub("application_number", "Application number at the bottom"),
            _sub("date", "Date"),
        ]),
        _item("brokerage_invoice", "Brokerage invoice", subs=[
            _sub("client_name", "Client's name"),
            _sub("amount_financed", "Amount financed"),
            _sub("application_reference", "Application reference number"),
            _sub("brokerage", "Brokerage"),
        ]),
        _item("approval_conditions", "Approval conditions"),
        _item("aml_confirmation", "AML confirmation"),
        _item(
            "tax_invoice", "Tax invoice",
            "If the invoice price is more than the approved amount, get an updated approval for the increased price.",
            subs=[
                _sub("lmct", "LMCT"),
                _sub("banking_details", "Banking details"),
                _sub("dealership", "Dealership name & ABN"),
                _sub("client", "Client's name & ABN"),
                _sub("address", "Address"),
                _sub("make", "Asset details – make"),
                _sub("model", "Model"),
                _sub("price", "Price"),
                _sub("colour", "Colour"),
                _sub("odometer", "Odometer (used and demo vehicles only)", optional=True),
                _sub("build_date", "Build date"),
                _sub("approved_amount", "Approved amount"),
            ],
        ),
        _item("insurance", "Insurance", _INSURANCE_NOTE, optional=True, subs=[
            _sub("borrower_name", "Borrower's name"),
            _sub("insurance_period", "Insurance period"),
            _sub("insured_amount", "Insured amount (the full amount, or without GST)"),
            _sub("policy_number", "Policy number"),
            _sub("vehicle_identifier", "Vehicle identifier (VIN / engine no. / rego)"),
            _sub("interested_party", "Interested party (lender's name)"),
        ]),
        _item("rates_notice", "Rates notice", "If there is no rates notice, a title search.", optional=True, subs=[
            _sub("issue_date", "Check issue date (valid for 1 year from issue)", optional=True),
            _sub("title_search", "Title search (valid for 30 days from issue)", optional=True),
            _sub("arrears", "If it is in arrears, proof of payment", optional=True),
            _sub("borrower_name", "On the borrower's / guarantor's name"),
            _sub("spouse", "If on a spouse's name, a copy of Medicare or the marriage certificate", optional=True),
        ]),
        _item("signed_docs", "Signed docs (up to signing by us)", subs=[
            _sub("signatures", "Signature and date of all the directors"),
            _sub("direct_debit", "Direct debit details"),
            _sub("witness", "Witness section"),
            _sub("bottom_visible", "Bottom visible on every page"),
        ]),
    ],
}

PRIVATE_SALE = {
    "kind": "private_sale",
    "title": "Settlement Pack – Private Sale",
    "items": [
        _item(
            "settlement_checklist", "Settlement checklist",
            "Fill in the client's name, ABN, deal #, insurer name, policy number, policy expiry, "
            "page no – application number at the bottom, and the date.",
        ),
        _item("brokerage_invoice", "Brokerage invoice", "Check the amount financed and brokerage against the EF quote."),
        _item("approval_conditions", "Approval conditions"),
        _item("aml_confirmation", "AML confirmation"),
        _item("seller_tax_invoice", "Seller – tax invoice", "Signed private sale invoice / tax invoice."),
        _item("insurance", "Insurance", _INSURANCE_NOTE, optional=True),
        _item(
            "payout_letter", "Payout letter",
            "If any. Should be in the seller's name, with account details, vehicle details and expiry date.",
            optional=True,
        ),
        _item("seller_bank_statement", "Seller bank account statement"),
        _item("seller_rego", "Seller rego"),
        _item("vir", "VIR"),
        _item(
            "rates_notice", "Rates notice",
            "If there is no rates notice, a title search. Don't add a rates notice that shows arrears.",
            optional=True,
        ),
        _item("vehicle_photos", "Vehicle photos", "Front, back, left, right, interior, odometer, VIN / build plate."),
        _item("signed_docs", "Signed docs (up to signing by us)"),
    ],
}

# Checked before the settlement docs go to the lender — the asset-finance
# "Settlement Docs – Submitted to Lender" stage (STAGE_ENTRY_CHECKLISTS).
LENDER_SUBMISSION = {
    "kind": "lender_submission",
    "title": "Submitted to Lender for Settlement",
    "items": [
        _item("insurance", "Insurance details", optional=True, subs=[
            _sub("insurance_company", "Name of the insurance company"),
            _sub("insurer", "Name of the insurer"),
            _sub("vin_rego", "VIN and rego details recorded"),
            _sub("start_date", "Start date in line with the insurance policy date"),
            _sub("interested_party", "Name of the interested party"),
            _sub("policy_number", "Policy number"),
        ]),
        _item("rates_notice", "Rates notice", optional=True, subs=[
            _sub("valid_recent", "Valid and most recent – check the date"),
            _sub("arrears_checked", "Checked for arrears"),
            _sub("property_address", "Property address checked"),
            _sub("arrears_proof", "Proof of payment supplied if arrears are noted", optional=True),
            _sub("arrears_category", "Arrears in the due or overdue category", optional=True),
            _sub("spouse", "If under a spouse's name, Medicare card and licence for both individuals", optional=True),
        ]),
        _item("signed_docs", "Signed docs", subs=[
            _sub("saved_in_folder", "All docs saved in the folder"),
            _sub("dd_et_balloon", "Direct debit, early termination and balloon payout held"),
            _sub("privacies", "Signed privacies held"),
            _sub("compliance_docs", "Compliance docs held"),
            _sub("compliance_notes", "Compliance notes left in the portal (discussion held with the broker)"),
            _sub("seller_compliance", "Private sale, dealer and auction house compliance docs held"),
            _sub("google_review", "Google review collected prior to settlement"),
            _sub("references", "2 references collected on file"),
            _sub("dd_verified", "Direct debit details verified by the bank statement"),
            _sub("witness", "Witness of the docs checked", optional=True),
            _sub("four_corners", "Scanned pages checked – all 4 corners visible"),
            _sub("client_photos", "Photos sent by the client checked – clear and legible"),
            _sub("referrer", "Referrer noted", optional=True),
        ]),
        _item("other_documents", "Any other document related to the settlement of the loan"),
    ],
}

# What must be done when a loan settles. The items needing paperwork that only
# arrives later are follow-ups: tasks due three days after settlement.
LOAN_SETTLED = {
    "kind": "loan_settled",
    "title": "Loan Settled – Checklist",
    "items": [
        _item("settlement_date", "Settlement completed date confirmed"),
        _item("remittance_supplier", "Remittance sent to supplier", optional=True),
        _item("remittance_client", "Remittance sent to client"),
        _item("doc_fee_rebate", "Doc fee rebate", optional=True),
        _item("connective_invoice", "Connective invoice uploaded"),
        _item("referrer_recorded", "Name of the referrer recorded", optional=True),
        _item("supplier_recorded", "Name of the dealer / private supplier / auction house recorded", optional=True),
        _item("tax_invoice_request", "Tax invoice request received – supplier details loaded", optional=True),
        _item("et_balloon_signed", "Early termination & balloon payout signed", optional=True),
        _item("date_settled", "Date loan settled recorded"),
        _item(
            "asset_details", "Asset details recorded",
            "Equipment / commercial / home loan: VIN recorded, home address recorded, commercial GSA recorded — prior to settlement.",
        ),
        _item("google_review", "Google review collected", "Upon approval."),
    ],
    "follow_ups": [
        _follow_up("amortisation_schedule", "Amortisation schedule received"),
        _follow_up("contract_number", "Contract number recorded", "If applicable — a must for equipment finance."),
        _follow_up(
            "accountant_pack", "Accountant pack downloaded",
            "Equipment finance: tax invoice, settlement confirmation and amortisation schedule.",
        ),
        _follow_up("accountant_details", "Accountant details recorded"),
        _follow_up("accountant_intro", "Accountant contacted for introduction"),
    ],
}

TEMPLATES = {t["kind"]: t for t in (CONSUMER, DEALER_SALE, PRIVATE_SALE, LENDER_SUBMISSION, LOAN_SETTLED)}

# Which checklists serve each purpose (see models/settlement_checklist.py), and
# what the refusal names when one is incomplete.
PURPOSE_KINDS = {
    "settlement_pack": ("consumer", "dealer_sale", "private_sale"),
    "lender_submission": ("lender_submission",),
    "loan_settled": ("loan_settled",),
}
PURPOSE_LABELS = {
    "settlement_pack": ("settlement pack", "Submitted to Lender"),
    "lender_submission": ("lender submission checklist", "Submitted to Lender"),
    "loan_settled": ("loan settled checklist", "Settled"),
}


def _check_purpose(purpose: str) -> None:
    if purpose not in PURPOSE_KINDS:
        raise HTTPException(status_code=400, detail="Unknown checklist")


def _row(db: Session, application: LoanApplication, purpose: str) -> Optional[SettlementChecklist]:
    return db.query(SettlementChecklist).filter(
        SettlementChecklist.application_id == application.id,
        SettlementChecklist.purpose == purpose,
    ).first()


def suggested_kind(db: Session, application: LoanApplication, purpose: str = "settlement_pack") -> str:
    """The checklist this deal most likely needs: an individual's consumer loan
    gets the consumer checklist; anything else goes by who is selling the asset
    — the sale type marked on the application, else the latest tax invoice's
    seller — private seller or dealer, dealer when neither says yet.
    A purpose with a single checklist just gets that one."""
    if len(PURPOSE_KINDS[purpose]) == 1:
        return PURPOSE_KINDS[purpose][0]
    sub_type = application_sub_type(application)
    if application.applicant_type == APPLICANT_TYPE_INDIVIDUAL and sub_type in CONSUMER_SUB_TYPES:
        return "consumer"
    sale_type, _ = effective_sale_type(db, application)
    if sale_type == SupplierType.private.value:
        return "private_sale"
    return "dealer_sale"


def clean_answers(kind: str, raw: dict, purpose: str = "settlement_pack") -> dict:
    """Keep only answers that belong to the template; 400 on a kind that isn't
    one of the purpose's checklists."""
    template = TEMPLATES.get(kind)
    if not template or kind not in PURPOSE_KINDS.get(purpose, ()):
        raise HTTPException(status_code=400, detail="Unknown settlement checklist")
    out: dict = {}
    for item in template["items"]:
        answer = raw.get(item["key"]) or {}
        state = answer.get("state")
        if state not in ("done", "na"):
            state = None
        if state == "na" and not item["optional"]:
            state = None
        sub_keys = {s["key"] for s in item["subs"]}
        subs = [k for k in (answer.get("subs") or []) if k in sub_keys]
        out[item["key"]] = {"state": state, "subs": subs}
    return out


def outstanding(kind: str, answers: dict) -> list[str]:
    """Labels of the items still unanswered — empty when the checklist is complete."""
    missing: list[str] = []
    for item in TEMPLATES[kind]["items"]:
        answer = answers.get(item["key"]) or {}
        state = answer.get("state")
        if state == "na" and item["optional"]:
            continue
        if state != "done":
            missing.append(item["label"])
            continue
        ticked = set(answer.get("subs") or [])
        if any(not s["optional"] and s["key"] not in ticked for s in item["subs"]):
            missing.append(item["label"])
    return missing


def load_answers(checklist: Optional[SettlementChecklist]) -> dict:
    if not checklist or not checklist.answers:
        return {}
    try:
        return json.loads(checklist.answers)
    except ValueError:
        return {}


def save(
    db: Session,
    application: LoanApplication,
    purpose: str,
    kind: str,
    raw_answers: dict,
    actor_id: str,
    actor_name: Optional[str],
    tenant_id: Optional[str],
) -> SettlementChecklist:
    """Store the broker's answers. Completion is derived, never posted."""
    _check_purpose(purpose)
    answers = clean_answers(kind, raw_answers, purpose)
    checklist = _row(db, application, purpose)
    if not checklist:
        checklist = SettlementChecklist(application_id=application.id, tenant_id=tenant_id, purpose=purpose, kind=kind)
        db.add(checklist)
    checklist.kind = kind
    checklist.answers = json.dumps(answers)
    checklist.prepared_by_id = actor_id
    checklist.prepared_by_name = actor_name
    complete = not outstanding(kind, answers)
    if complete and checklist.completed_at is None:
        checklist.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    elif not complete:
        checklist.completed_at = None
    return checklist


def require_complete(db: Session, application: LoanApplication, purpose: str) -> None:
    """Refuse the move while the deal's checklist for `purpose` is incomplete,
    naming what is missing."""
    noun, stage = PURPOSE_LABELS[purpose]
    message = f"Complete the {noun} before moving to {stage}."
    checklist = _row(db, application, purpose)
    if not checklist or checklist.kind not in PURPOSE_KINDS[purpose]:
        raise HTTPException(status_code=400, detail=message)
    missing = outstanding(checklist.kind, load_answers(checklist))
    if missing:
        raise HTTPException(status_code=400, detail=f"{message} Outstanding: {', '.join(missing)}")


def serialize(db: Session, application: LoanApplication, purpose: str) -> dict:
    _check_purpose(purpose)
    checklist = _row(db, application, purpose)
    suggested = suggested_kind(db, application, purpose)
    kind = checklist.kind if checklist and checklist.kind in PURPOSE_KINDS[purpose] else suggested
    answers = clean_answers(kind, load_answers(checklist) if checklist and checklist.kind == kind else {}, purpose)
    sale_type, sale_type_source = effective_sale_type(db, application)
    return {
        "purpose": purpose,
        "kind": kind,
        "suggested_kind": suggested,
        # Who the asset is bought from, as the Tax Invoices tab has it.
        "sale_type": {"sale_type": sale_type, "source": sale_type_source},
        "answers": answers,
        "outstanding": outstanding(kind, answers),
        "completed_at": checklist.completed_at if checklist else None,
        "prepared_by_name": checklist.prepared_by_name if checklist else None,
        "updated_at": checklist.updated_at if checklist else None,
        "templates": [TEMPLATES[k] for k in PURPOSE_KINDS[purpose]],
    }


def create_follow_up_tasks(
    db: Session,
    application: LoanApplication,
    purpose: str,
    actor_id: str,
    tenant_id: Optional[str],
) -> list:
    """Raise the purpose's follow-ups as tasks on the deal, due `days_after`
    the move, for the deal's broker (the mover when it has none). A follow-up
    already raised for this deal is left alone, so re-entering the stage
    doesn't double them up. The tasks' due-date reminders come from the
    scheduler like any other task's."""
    from app.models.task import Task, TaskPriority, TaskStatus

    follow_ups = [f for kind in PURPOSE_KINDS[purpose] for f in TEMPLATES[kind].get("follow_ups", [])]
    if not follow_ups:
        return []
    broker_ids = [b.id for b in application.brokers] or (
        [application.assigned_broker_id] if application.assigned_broker_id else []
    )
    assignee = broker_ids[0] if broker_ids else actor_id
    existing = {
        t.title for t in db.query(Task.title).filter(Task.application_id == application.id).all()
    }
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    created = []
    for f in follow_ups:
        if f["title"] in existing:
            continue
        task = Task(
            title=f["title"],
            description=f["note"],
            status=TaskStatus.todo,
            priority=TaskPriority.medium,
            due_date=now + timedelta(days=f["days_after"]),
            assigned_to_id=assignee,
            application_id=application.id,
            created_by_id=actor_id,
            tenant_id=tenant_id,
        )
        db.add(task)
        created.append(task)
    return created
