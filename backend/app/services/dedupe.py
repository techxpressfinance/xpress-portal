"""Duplicate detection + merging for contacts and companies.

All contact PII is encrypted at rest (EncryptedString), so matching happens in
Python over decrypted values — never in SQL. Detection is two-tier:

- "high" confidence: safe to auto-merge (shared licence number, same name plus a
  corroborating identifier, matching ABN, ...).
- "review" confidence: probably the same person/company but needs a human
  (name-only match, shared email with a different name, ...).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.contact import Contact, ContactOrganization, Organization
from app.models.lending_history_entry import LendingHistoryEntry
from app.models.loan_applicant import ApplicationGuarantor, LoanApplicant
from app.models.loan_application import LoanApplication

# --- Normalisation -----------------------------------------------------------

_DOB_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y")

_STREET_ABBREVIATIONS = {
    "st": "street",
    "rd": "road",
    "ave": "avenue",
    "av": "avenue",
    "dr": "drive",
    "hwy": "highway",
    "ct": "court",
    "pl": "place",
    "cres": "crescent",
    "tce": "terrace",
    "pde": "parade",
    "blvd": "boulevard",
}

_ORG_LEGAL_SUFFIXES = {"pty", "ltd", "limited", "proprietary", "plc", "inc", "incorporated", "co"}


def normalize_text(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def normalize_phone(value: Optional[str]) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 11 and digits.startswith("61"):
        digits = "0" + digits[2:]
    elif len(digits) == 9 and digits[0] != "0":
        digits = "0" + digits
    return digits if len(digits) >= 8 else ""


def normalize_dob(value: Optional[str]) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    for fmt in _DOB_FORMATS:
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw.lower()


def normalize_address(*parts: Optional[str]) -> str:
    joined = " ".join(p for p in (parts or ()) if p)
    tokens = re.sub(r"[^a-z0-9]+", " ", joined.lower()).split()
    tokens = [_STREET_ABBREVIATIONS.get(t, t) for t in tokens]
    normalized = " ".join(tokens)
    # Too short to be a meaningful address signal (e.g. just a state)
    return normalized if len(normalized) >= 8 else ""


def normalize_abn(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def normalize_org_name(value: Optional[str]) -> str:
    tokens = re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).split()
    return " ".join(tokens)


def strip_org_suffixes(normalized_name: str) -> str:
    tokens = normalized_name.split()
    while tokens and tokens[-1] in _ORG_LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


# --- Union-find ---------------------------------------------------------------


class _UnionFind:
    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        parent = self._parent.setdefault(x, x)
        if parent != x:
            self._parent[x] = parent = self.find(parent)
        return parent

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[rb] = ra

    def components(self) -> list[list[str]]:
        groups: dict[str, list[str]] = {}
        for x in self._parent:
            groups.setdefault(self.find(x), []).append(x)
        return [members for members in groups.values() if len(members) >= 2]


# --- Contact detection ----------------------------------------------------------


def contact_signals(
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    date_of_birth: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    address: Optional[str] = None,
    suburb: Optional[str] = None,
    state: Optional[str] = None,
    postcode: Optional[str] = None,
    drivers_license_number: Optional[str] = None,
) -> dict[str, str]:
    first = normalize_text(first_name)
    last = normalize_text(last_name)
    return {
        "name": f"{first}|{last}" if first and last else "",
        "dob": normalize_dob(date_of_birth),
        "phone": normalize_phone(phone),
        "email": normalize_text(email),
        "address": normalize_address(address, suburb, state, postcode),
        "licence": normalize_text(drivers_license_number),
    }


def _contact_signals(c: Contact) -> dict[str, str]:
    return contact_signals(
        c.first_name, c.last_name, c.date_of_birth, c.phone, c.email,
        c.address, c.suburb, c.state, c.postcode, c.drivers_license_number,
    )


_CONTACT_REASON_LABELS = (
    ("name", "name"),
    ("dob", "date of birth"),
    ("phone", "phone"),
    ("email", "email"),
    ("address", "address"),
    ("licence", "licence number"),
)


def _classify_contact_pair(sa: dict[str, str], sb: dict[str, str]) -> tuple[Optional[str], list[str]]:
    eq = {key: bool(sa[key]) and sa[key] == sb[key] for key in sa}
    reasons = [label for key, label in _CONTACT_REASON_LABELS if eq[key]]
    if eq["licence"] or (eq["name"] and (eq["dob"] or eq["phone"] or eq["email"])) or (eq["phone"] and eq["email"]):
        return "high", reasons
    # Same name (possibly plus address), or a shared identifier under a
    # different name (spouses sharing an email, re-keyed maiden names, ...)
    if eq["name"] or eq["email"] or eq["phone"]:
        return "review", reasons
    return None, []


def _build_groups(
    entities: dict[str, object],
    signals: dict[str, dict[str, str]],
    bucket_keys: tuple[str, ...],
    classify,
) -> tuple[list[dict], list[list[object]]]:
    """Bucket entities by shared signal values, classify candidate pairs, and
    connect them with union-find.

    Returns (display_groups, high_groups): display groups carry confidence +
    matched-on labels for the review UI; high groups are the auto-mergeable
    clusters (connected through high-confidence edges only).
    """
    buckets: dict[tuple[str, str], list[str]] = {}
    for entity_id, sig in signals.items():
        for key in bucket_keys:
            if sig[key]:
                buckets.setdefault((key, sig[key]), []).append(entity_id)

    candidate_pairs: set[tuple[str, str]] = set()
    for members in buckets.values():
        members = sorted(members)
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                candidate_pairs.add((a, b))

    all_uf = _UnionFind()
    high_uf = _UnionFind()
    pair_meta: dict[tuple[str, str], tuple[str, list[str]]] = {}
    for a, b in candidate_pairs:
        level, reasons = classify(signals[a], signals[b])
        if not level:
            continue
        pair_meta[(a, b)] = (level, reasons)
        all_uf.union(a, b)
        if level == "high":
            high_uf.union(a, b)

    high_components = high_uf.components()
    high_sets = [set(m) for m in high_components]

    display_groups: list[dict] = []
    for members in all_uf.components():
        member_set = set(members)
        matched_on: list[str] = []
        for (a, b), (_level, reasons) in pair_meta.items():
            if a in member_set and b in member_set:
                matched_on.extend(r for r in reasons if r not in matched_on)
        confidence = "high" if member_set in high_sets else "review"
        display_groups.append({
            "confidence": confidence,
            "matched_on": matched_on,
            "members": _sorted_by_created([entities[m] for m in members]),
        })

    high_groups = [_sorted_by_created([entities[m] for m in members]) for members in high_components]
    display_groups.sort(key=lambda g: (g["confidence"] != "high", -len(g["members"])))
    return display_groups, high_groups


def _sorted_by_created(items: list) -> list:
    return sorted(items, key=lambda e: (e.created_at or datetime.min, e.id))


def find_contact_duplicates(contacts: list[Contact]) -> tuple[list[dict], list[list[Contact]]]:
    entities = {c.id: c for c in contacts}
    signals = {c.id: _contact_signals(c) for c in contacts}
    return _build_groups(entities, signals, ("name", "phone", "email", "licence"), _classify_contact_pair)


# --- Organization detection -----------------------------------------------------


def org_signals(
    name: Optional[str] = None,
    abn: Optional[str] = None,
    address: Optional[str] = None,
) -> dict[str, str]:
    normalized = normalize_org_name(name)
    return {
        "name": normalized,
        "stripped": strip_org_suffixes(normalized),
        "abn": normalize_abn(abn),
        "address": normalize_address(address),
    }


def _org_signals(o: Organization) -> dict[str, str]:
    return org_signals(o.name, o.abn, o.address)


def _classify_org_pair(sa: dict[str, str], sb: dict[str, str]) -> tuple[Optional[str], list[str]]:
    abn_eq = bool(sa["abn"]) and sa["abn"] == sb["abn"]
    abn_conflict = bool(sa["abn"]) and bool(sb["abn"]) and sa["abn"] != sb["abn"]
    name_eq = bool(sa["name"]) and sa["name"] == sb["name"]
    stripped_eq = bool(sa["stripped"]) and sa["stripped"] == sb["stripped"]
    addr_eq = bool(sa["address"]) and sa["address"] == sb["address"]

    reasons = []
    if abn_eq:
        reasons.append("ABN")
    if name_eq:
        reasons.append("name")
    elif stripped_eq:
        reasons.append("similar name")
    if addr_eq:
        reasons.append("address")

    if abn_eq:
        return "high", reasons
    if abn_conflict:
        # Same/similar name but genuinely different ABNs — related entities
        # (e.g. a trust and its trading company), not duplicates.
        return None, []
    if name_eq:
        return "high", reasons
    if stripped_eq:
        return "review", reasons
    return None, []


def find_org_duplicates(orgs: list[Organization]) -> tuple[list[dict], list[list[Organization]]]:
    entities = {o.id: o for o in orgs}
    signals = {o.id: _org_signals(o) for o in orgs}
    return _build_groups(entities, signals, ("name", "stripped", "abn"), _classify_org_pair)


# --- Candidate matching (create-time duplicate warnings) -------------------------


def match_candidate_contacts(candidate: dict[str, str], contacts: list[Contact]) -> list[tuple[Contact, str, list[str]]]:
    """Classify a not-yet-created contact (signals from ``contact_signals``)
    against existing contacts. Returns (contact, confidence, reasons), high first."""
    matches = [
        (c, level, reasons)
        for c in contacts
        for level, reasons in [_classify_contact_pair(candidate, _contact_signals(c))]
        if level
    ]
    matches.sort(key=lambda m: m[1] != "high")
    return matches


def match_candidate_orgs(candidate: dict[str, str], orgs: list[Organization]) -> list[tuple[Organization, str, list[str]]]:
    """Classify a not-yet-created company (signals from ``org_signals``)
    against existing companies. Returns (org, confidence, reasons), high first."""
    matches = [
        (o, level, reasons)
        for o in orgs
        for level, reasons in [_classify_org_pair(candidate, _org_signals(o))]
        if level
    ]
    matches.sort(key=lambda m: m[1] != "high")
    return matches


# --- Merging --------------------------------------------------------------------


def _fill_missing(primary, duplicates: list, fields: tuple[str, ...]) -> None:
    for field in fields:
        if (getattr(primary, field) or "").strip():
            continue
        for dup in duplicates:
            value = (getattr(dup, field) or "").strip()
            if value:
                setattr(primary, field, value)
                break


def _merge_notes(primary, duplicates: list) -> None:
    notes = [(c.notes or "").strip() for c in [primary, *duplicates]]
    unique = list(dict.fromkeys(n for n in notes if n))
    if unique:
        primary.notes = "\n".join(unique)


def merge_contacts(db: Session, primary: Contact, duplicates: list[Contact]) -> None:
    """Merge duplicates into primary: fill empty fields, repoint every FK, delete dups.

    Caller commits.
    """
    _fill_missing(primary, duplicates, ("email", "phone", "date_of_birth", "drivers_license_number", "middle_name"))

    # Address is taken as a unit from the first duplicate that has one, so the
    # merged record doesn't end up with a Frankenstein address.
    if not any((getattr(primary, f) or "").strip() for f in ("address", "suburb", "state", "postcode")):
        best = max(
            duplicates,
            key=lambda c: sum(1 for f in ("address", "suburb", "state", "postcode") if (getattr(c, f) or "").strip()),
            default=None,
        )
        if best:
            for f in ("address", "suburb", "state", "postcode"):
                setattr(primary, f, (getattr(best, f) or "").strip() or None)

    _merge_notes(primary, duplicates)

    dup_ids = [d.id for d in duplicates]
    for model, column in (
        (LoanApplication, LoanApplication.contact_id),
        (LoanApplicant, LoanApplicant.contact_id),
        (LendingHistoryEntry, LendingHistoryEntry.contact_id),
        (LendingHistoryEntry, LendingHistoryEntry.guaranteed_by_contact_id),
    ):
        db.query(model).filter(column.in_(dup_ids)).update(
            {column.key: primary.id}, synchronize_session="fetch"
        )

    primary_org_ids = {
        link.organization_id
        for link in db.query(ContactOrganization).filter(ContactOrganization.contact_id == primary.id).all()
    }
    for link in db.query(ContactOrganization).filter(ContactOrganization.contact_id.in_(dup_ids)).all():
        if link.organization_id in primary_org_ids:
            db.delete(link)
        else:
            link.contact_id = primary.id
            primary_org_ids.add(link.organization_id)

    for dup in duplicates:
        db.delete(dup)


def merge_organizations(db: Session, primary: Organization, duplicates: list[Organization]) -> None:
    """Merge duplicate companies into primary: fill fields, repoint FKs, delete dups.

    Caller commits.
    """
    _fill_missing(primary, duplicates, ("industry", "address"))
    _merge_notes(primary, duplicates)

    # ABN moves last: uq_org_abn_tenant means the duplicate must release the
    # ABN before the primary can take it.
    new_abn = None
    if not (primary.abn or "").strip():
        for dup in duplicates:
            if (dup.abn or "").strip():
                new_abn = dup.abn
                dup.abn = None
                break

    dup_ids = [d.id for d in duplicates]
    db.query(LoanApplication).filter(LoanApplication.business_organization_id.in_(dup_ids)).update(
        {"business_organization_id": primary.id}, synchronize_session="fetch"
    )
    db.query(ApplicationGuarantor).filter(ApplicationGuarantor.organization_id.in_(dup_ids)).update(
        {"organization_id": primary.id}, synchronize_session="fetch"
    )

    primary_contact_ids = {
        link.contact_id
        for link in db.query(ContactOrganization).filter(ContactOrganization.organization_id == primary.id).all()
    }
    for link in db.query(ContactOrganization).filter(ContactOrganization.organization_id.in_(dup_ids)).all():
        if link.contact_id in primary_contact_ids:
            db.delete(link)
        else:
            link.organization_id = primary.id
            primary_contact_ids.add(link.contact_id)

    for dup in duplicates:
        db.delete(dup)
    if new_abn:
        db.flush()  # duplicate row (and its ABN) must be gone before primary claims it
        primary.abn = new_abn
