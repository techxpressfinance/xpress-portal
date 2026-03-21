from __future__ import annotations

import json
import logging
import time
from base64 import b64encode
from datetime import datetime, timezone

import httpx

from app.config import LEND_API_KEY, LEND_API_SECRET, LEND_ENABLED, LEND_ENVIRONMENT

logger = logging.getLogger(__name__)

_BASE_URL = "https://partners.lend.com.au"

# In-memory picklist cache: {name: (data, fetched_at)}
_picklist_cache: dict[str, tuple[list, float]] = {}
_CACHE_TTL = 3600  # 1 hour


import re


def _normalize_au_phone(phone: str) -> str:
    """Normalize phone to Australian 10-digit format (e.g. 0412345678)."""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("61") and len(digits) == 11:
        digits = "0" + digits[2:]
    if not digits.startswith("0") and len(digits) == 9:
        digits = "0" + digits
    return digits[:10]


def _get_auth_headers() -> dict[str, str]:
    token = b64encode(f"{LEND_API_KEY}:{LEND_API_SECRET}".encode()).decode()
    return {
        "Authorization": f"Basic {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Version": "20190501",
        "Environment": LEND_ENVIRONMENT,
    }


def get_picklist(name: str) -> list:
    now = time.time()
    # Evict stale entries
    stale = [k for k, (_, ts) in _picklist_cache.items() if now - ts >= _CACHE_TTL]
    for k in stale:
        del _picklist_cache[k]

    if name in _picklist_cache:
        data, fetched_at = _picklist_cache[name]
        if now - fetched_at < _CACHE_TTL:
            return data

    url = f"{_BASE_URL}/api/configs/{name}"
    with httpx.Client(timeout=30) as client:
        resp = client.get(url, headers=_get_auth_headers())
        resp.raise_for_status()
        data = resp.json()

    _picklist_cache[name] = (data, now)
    return data


def _map_credit_history(value: str) -> str:
    """Map our credit history values to Lend's expected values."""
    mapping = {
        "Clear": "Good",
        "Minor Issues": "Paid Defaults",
        "Major Issues": "Unpaid Defaults",
        "Bankrupt": "Ex Bankrupt",
        "Unknown": "Not Sure",
    }
    return mapping.get(value, value)


def _map_residency(value: str) -> str:
    """Map our residency values to Lend's expected values."""
    mapping = {
        "Australian Citizen": "Citizen",
        "Permanent Resident": "Permanent Resident",
        "Temporary Visa": "Visa",
        "Other": "Visa",
    }
    return mapping.get(value, value)


def build_lead_payload(app, user, extra_data: dict | None = None) -> dict:
    extra = extra_data or {}
    is_commercial = app.loan_type.value == "business"

    # Determine product_type_id (defaults per loan type on Lend)
    _default_product_type = {"vehicle": 25, "personal": 26, "home": 24, "business": 1}
    product_type_id = app.lend_product_type_id or _default_product_type.get(app.loan_type.value, 1)

    first_name = app.applicant_first_name or user.full_name.split()[0]
    last_name = app.applicant_last_name or (user.full_name.split()[-1] if len(user.full_name.split()) > 1 else "")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Owner object (applicant details)
    owner: dict = {
        "title": app.applicant_title or "Mr",
        "first_name": first_name,
        "last_name": last_name,
        "middle_name": app.applicant_middle_name or "",
        "contact_number": _normalize_au_phone(user.phone or ""),
        "email": user.email,
        "consent": today,
    }

    if app.applicant_dob:
        owner["dob"] = app.applicant_dob
    if app.applicant_gender:
        owner["gender"] = app.applicant_gender
    if app.applicant_marital_status:
        owner["marital_status"] = app.applicant_marital_status

    # Address on owner (for commercial leads)
    if is_commercial and app.applicant_address:
        owner["address"] = app.applicant_address
        owner["suburb"] = app.applicant_suburb or ""
        owner["state"] = app.applicant_state or ""
        owner["postcode"] = app.applicant_postcode or ""

    # Identification
    identification = extra.get("identification", [])
    for id_doc in identification:
        id_type = id_doc.get("type", "")
        if id_type == "Drivers Licence":
            owner["driving_licence_num"] = id_doc.get("number", "")
            owner["driving_licence_state"] = id_doc.get("state", "")
        elif id_type == "Medicare":
            owner["medicare_number"] = id_doc.get("number", "")
            owner["medicare_ref"] = id_doc.get("reference", "")
        elif id_type == "Passport":
            owner["passport_number"] = id_doc.get("number", "")
            owner["passport_country"] = id_doc.get("country", "Australia")

    # Credit history & residency
    credit_history = extra.get("credit_history")
    if credit_history:
        owner["credit_history"] = _map_credit_history(credit_history)
    residency = extra.get("residency_status")
    if residency:
        owner["residency_status"] = _map_residency(residency)

    # Lead object
    lead: dict = {
        "product_type_id": product_type_id,
        "amount_requested": float(app.amount),
        "send_type": app.lend_send_type or "Manual",
        "who_to_contact": app.lend_who_to_contact or "Broker",
        "company_registration_date": today,
        "b_country": "AU",
    }

    # purpose_id is required by Lend — default to 1 ("General") when not set
    lead["purpose_id"] = app.loan_purpose_id or 1
    if app.loan_term_requested:
        lead["loan_term_requested"] = app.loan_term_requested

    if is_commercial:
        # Commercial lead fields
        if app.lend_owner_type:
            owner["owner_type"] = app.lend_owner_type
        lead["organisation_name"] = app.business_name or f"{first_name} {last_name}"
        lead["abn"] = (app.business_abn or "").replace(" ", "")
        if app.business_registration_date:
            lead["company_registration_date"] = app.business_registration_date
        lead["industry_id"] = app.business_industry_id or 57
        lead["sales_monthly"] = float(app.business_monthly_sales) if app.business_monthly_sales else 0
    else:
        # Consumer lead required placeholder fields
        lead["lead_type"] = "Commercial"
        lead["organisation_name"] = f"{first_name} {last_name}"
        lead["industry_id"] = 57
        lead["sales_monthly"] = 50

    payload: dict = {
        "owner": owner,
        "lead": lead,
    }

    # Notes
    if app.notes:
        payload["lead_notes"] = [{"notes": app.notes[:1000]}]

    # Consumer-specific nested arrays
    if not is_commercial:
        # Addresses (living_status and date_from required by Lend)
        if app.applicant_address:
            addr_extra = {}
            if extra.get("addresses") and len(extra["addresses"]) > 0:
                addr_extra = extra["addresses"][0]
            payload["lead_owner_addresses"] = [{
                "address": app.applicant_address,
                "suburb": app.applicant_suburb or "",
                "state": app.applicant_state or "",
                "postcode": app.applicant_postcode or "",
                "country": "AU",
                "living_status": addr_extra.get("living_status", "Renting"),
                "date_from": addr_extra.get("date_from", today),
            }]
        elif extra.get("addresses"):
            payload["lead_owner_addresses"] = extra["addresses"]

        # Employments (lead_owner_occupation_id and valid date_from required by Lend)
        employments = extra.get("employments", [])
        if employments:
            payload["lead_owner_employments"] = [{
                "lead_owner_occupation_id": emp.get("occupation_id", 1),
                "employer": emp.get("employer_name", ""),
                "employment_type": emp.get("employment_type", ""),
                "date_from": emp.get("start_date") or today,
            } for emp in employments]

        # Incomes (config_income_id required by Lend)
        incomes = extra.get("incomes", [])
        if incomes:
            payload["lead_owner_incomes"] = [{
                "config_income_id": inc.get("config_income_id", 1),
                "amount": inc.get("amount", 0),
            } for inc in incomes]

    # Dependants
    dependants = extra.get("dependants", 0)
    if dependants and int(dependants) > 0:
        payload["lead_owner_dependants"] = [{"age": 10}] * int(dependants)

    return payload


class LendAPIError(Exception):
    """Raised when Lend returns a non-success response with parseable error details."""
    def __init__(self, status_code: int, errors: list[dict], raw: str):
        self.status_code = status_code
        self.errors = errors
        self.raw = raw
        # Build a human-readable message from the field errors
        parts = []
        for err in errors:
            field = err.get("field", "").replace("lead[", "").replace("owner[", "").rstrip("]")
            msg = err.get("error", "Unknown error")
            parts.append(f"{field}: {msg}" if field else msg)
        self.message = "; ".join(parts) if parts else raw[:500]
        super().__init__(self.message)


def submit_lead(payload: dict) -> dict:
    url = f"{_BASE_URL}/api/leads"
    headers = _get_auth_headers()
    logger.info("Submitting lead to Lend [env=%s]: %s", LEND_ENVIRONMENT, json.dumps(payload, default=str))
    with httpx.Client(timeout=60) as client:
        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            logger.error("Lend API returned %s error: %s", resp.status_code, resp.text[:1000])
            # Try to parse structured errors from Lend
            try:
                body = resp.json()
                errors = body.get("errors", [])
                error_msg = body.get("error", "")
                if errors:
                    raise LendAPIError(resp.status_code, errors, resp.text[:2000])
                if error_msg:
                    raise LendAPIError(resp.status_code, [], error_msg)
            except (json.JSONDecodeError, LendAPIError):
                raise
            resp.raise_for_status()
        result = resp.json()
        logger.info("Lend lead submitted successfully, ref=%s", result.get("ref") or result.get("lead_ref"))
        return result


def upload_attachment(lead_ref: str, file_bytes: bytes, filename: str, document_type: str, verified: bool = False) -> dict:
    url = f"{_BASE_URL}/api/attachments"
    headers = _get_auth_headers()
    headers.pop("Content-Type", None)  # let httpx set multipart content type

    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url,
            headers=headers,
            data={
                "lead_ref": lead_ref,
                "document_type": document_type,
                "verified": "1" if verified else "0",
            },
            files={"file": (filename, file_bytes)},
        )
        if resp.status_code >= 400:
            logger.error("Lend attachment %s error: %s", resp.status_code, resp.text[:2000])
            try:
                body = resp.json()
                errors = body.get("errors", [])
                error_msg = body.get("error", "")
                if errors:
                    raise LendAPIError(resp.status_code, errors, resp.text[:2000])
                if error_msg:
                    raise LendAPIError(resp.status_code, [], error_msg)
            except (json.JSONDecodeError, LendAPIError):
                raise
            resp.raise_for_status()
        return resp.json()


def _submit_new_lead(application_id: str, session_factory) -> str:
    """Build payload and submit a new lead to Lend. Returns the lead ref."""
    from app.models.loan_application import LoanApplication
    from app.models.user import User
    from app.services.db_context import background_session

    with background_session(session_factory) as db:
        app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
        user = db.query(User).filter(User.id == app.user_id).first()

        extra_data = {}
        if app.lend_extra_data:
            try:
                extra_data = json.loads(app.lend_extra_data)
            except json.JSONDecodeError:
                pass

        payload = build_lead_payload(app, user, extra_data)

    result = submit_lead(payload)
    lead_ref = result.get("ref") or result.get("lead_ref") or result.get("data", {}).get("ref")

    if not lead_ref:
        raise ValueError(f"No ref returned from Lend API: {result}")

    with background_session(session_factory) as db:
        app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
        app.lend_ref = lead_ref

    return lead_ref


def sync_to_lend_background(application_id: str, session_factory, force_new: bool = False) -> None:
    if not LEND_ENABLED:
        return

    from app.models.document import Document
    from app.models.loan_application import LoanApplication
    from app.services.db_context import background_session

    # Mark as pending; optionally clear stale ref
    with background_session(session_factory) as db:
        app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
        if not app:
            logger.error("Lend sync: application %s not found", application_id)
            return
        app.lend_sync_status = "pending"
        if force_new:
            app.lend_ref = None
            # Reset uploaded flags so docs get re-uploaded to the new lead
            for doc in db.query(Document).filter(Document.application_id == application_id).all():
                doc.lend_uploaded = False

    try:
        # Load app + documents snapshot
        with background_session(session_factory) as db:
            app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
            docs = db.query(Document).filter(Document.application_id == application_id).all()

            lead_ref = app.lend_ref
            app_snapshot_docs = [
                {
                    "id": d.id,
                    "lend_document_type": d.lend_document_type,
                    "lend_uploaded": d.lend_uploaded,
                    "file_path": d.file_path,
                    "original_filename": d.original_filename,
                    "is_verified": d.is_verified,
                }
                for d in docs
            ]

        # Submit lead if no ref yet
        if not lead_ref:
            lead_ref = _submit_new_lead(application_id, session_factory)

        # Upload documents with lend_document_type set
        for doc_info in app_snapshot_docs:
            if not doc_info["lend_document_type"] or doc_info["lend_uploaded"]:
                continue
            try:
                from app.services.s3_storage import download_file
                file_bytes = download_file(doc_info["file_path"])
                upload_attachment(
                    lead_ref,
                    file_bytes,
                    doc_info["original_filename"],
                    doc_info["lend_document_type"],
                    doc_info["is_verified"],
                )
                with background_session(session_factory) as db:
                    doc = db.query(Document).filter(Document.id == doc_info["id"]).first()
                    if doc:
                        doc.lend_uploaded = True
            except LendAPIError as exc:
                # If attachment fails because the lead doesn't exist, retry with fresh lead
                if "Record not found" in str(exc) and lead_ref:
                    logger.warning("Lead %s not found on Lend, creating fresh lead for app %s", lead_ref, application_id)
                    lead_ref = _submit_new_lead(application_id, session_factory)
                    # Reset uploaded flags so all docs get re-uploaded with new ref
                    for d in app_snapshot_docs:
                        d["lend_uploaded"] = False
                    break  # Restart document loop below
                logger.exception("Failed to upload doc %s to Lend", doc_info["id"])
            except Exception:
                logger.exception("Failed to upload doc %s to Lend", doc_info["id"])
        else:
            # Only skip the retry loop if we didn't break out
            app_snapshot_docs = []

        # Retry document uploads if we had to re-create the lead
        for doc_info in app_snapshot_docs:
            if not doc_info["lend_document_type"] or doc_info["lend_uploaded"]:
                continue
            try:
                from app.services.s3_storage import download_file
                file_bytes = download_file(doc_info["file_path"])
                upload_attachment(
                    lead_ref,
                    file_bytes,
                    doc_info["original_filename"],
                    doc_info["lend_document_type"],
                    doc_info["is_verified"],
                )
                with background_session(session_factory) as db:
                    doc = db.query(Document).filter(Document.id == doc_info["id"]).first()
                    if doc:
                        doc.lend_uploaded = True
            except Exception:
                logger.exception("Failed to upload doc %s to Lend (retry)", doc_info["id"])

        # Mark success
        with background_session(session_factory) as db:
            app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
            app.lend_sync_status = "synced"
            app.lend_synced_at = datetime.now(timezone.utc)
            app.lend_sync_error = None

        logger.info("Lend sync completed for application %s, ref=%s", application_id, lead_ref)

    except Exception as exc:
        logger.exception("Lend sync failed for application %s", application_id)
        with background_session(session_factory) as db:
            app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
            if app:
                app.lend_sync_status = "failed"
                app.lend_sync_error = str(exc)[:2000]
