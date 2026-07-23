"""In-process cache of decrypted searchable fields for global search.

Applicant/contact PII is encrypted at rest, so SQL LIKE can't prefilter it and
search must match decrypted values in Python. Loading every ORM row per query
would decrypt every encrypted column each time; this cache keeps only the
searchable plaintext in memory and re-syncs on every query with one cheap
(id, updated_at) sweep that reads no encrypted columns — only rows created or
changed since the last query are loaded and decrypted.

The sweep makes staleness impossible (deleted rows are evicted, changed rows
reloaded before use), so multiple workers can each hold their own copy; the
cache is never a source of truth. Memory cost is a few hundred bytes per row.
"""
from __future__ import annotations

import threading

from sqlalchemy.orm import Session, load_only

from app.models.contact import Contact
from app.models.loan_application import LoanApplication

_LOAD_BATCH = 500


def _enum_str(value):
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


class _SyncedCache:
    """{tenant_id: {row_id: (updated_at, fields)}}, re-synced per call."""

    def __init__(self):
        self._lock = threading.Lock()
        self._tenants: dict[str, dict] = {}

    def sync(self, tenant_id: str, live: dict, load_rows, extract) -> dict[str, dict]:
        """``live`` maps row_id -> updated_at for every row that should exist.

        Returns a snapshot {row_id: fields} safe to iterate without the lock.
        """
        with self._lock:
            entries = self._tenants.setdefault(tenant_id, {})
            for row_id in entries.keys() - live.keys():
                del entries[row_id]
            stale = [
                row_id
                for row_id, updated in live.items()
                if row_id not in entries or entries[row_id][0] != updated
            ]
            for i in range(0, len(stale), _LOAD_BATCH):
                for row in load_rows(stale[i : i + _LOAD_BATCH]):
                    entries[row.id] = (live[row.id], extract(row))
            return {row_id: entry[1] for row_id, entry in entries.items()}


_applications = _SyncedCache()
_contacts = _SyncedCache()

# Only the columns search scores or returns — loading the full row would also
# decrypt lend_extra_data and other large fields search never looks at.
_APP_SEARCH_COLUMNS = [
    LoanApplication.id,
    LoanApplication.user_id,
    LoanApplication.applicant_first_name,
    LoanApplication.applicant_last_name,
    LoanApplication.applicant_email,
    LoanApplication.applicant_mobile,
    LoanApplication.business_name,
    LoanApplication.trading_name,
    LoanApplication.lend_ref,
    LoanApplication.loan_type,
    LoanApplication.status,
    LoanApplication.applicant_state,
    LoanApplication.notes,
    LoanApplication.amount,
    LoanApplication.created_at,
]


def _extract_application(a: LoanApplication) -> dict:
    return {
        "id": a.id,
        "user_id": a.user_id,
        "applicant_name": " ".join(p for p in [a.applicant_first_name, a.applicant_last_name] if p) or None,
        "applicant_email": a.applicant_email,
        "applicant_mobile": a.applicant_mobile,
        "business_name": a.business_name,
        "trading_name": a.trading_name,
        "lend_ref": a.lend_ref,
        "loan_type": _enum_str(a.loan_type),
        "status": _enum_str(a.status),
        "applicant_state": a.applicant_state,
        "notes": a.notes,
        "amount": float(a.amount) if a.amount is not None else None,
        "created_at": a.created_at,
    }


def get_searchable_applications(db: Session, tenant_id: str) -> dict[str, dict]:
    live = dict(
        db.query(LoanApplication.id, LoanApplication.updated_at)
        .filter(LoanApplication.tenant_id == tenant_id, LoanApplication.deleted_at.is_(None))
        .all()
    )
    return _applications.sync(
        tenant_id,
        live,
        lambda ids: db.query(LoanApplication)
        .options(load_only(*_APP_SEARCH_COLUMNS))
        .filter(LoanApplication.id.in_(ids))
        .all(),
        _extract_application,
    )


def _extract_contact(c: Contact) -> dict:
    return {
        "id": c.id,
        "full_name": " ".join(p for p in [c.first_name, c.middle_name, c.last_name] if p),
        "email": c.email,
        "phone": c.phone,
        "drivers_license_number": c.drivers_license_number,
        "suburb": c.suburb,
        "state": c.state,
        "created_at": c.created_at,
    }


def get_searchable_contacts(db: Session, tenant_id: str) -> dict[str, dict]:
    live = dict(
        db.query(Contact.id, Contact.updated_at).filter(Contact.tenant_id == tenant_id).all()
    )
    return _contacts.sync(
        tenant_id,
        live,
        lambda ids: db.query(Contact).filter(Contact.id.in_(ids)).all(),
        _extract_contact,
    )
