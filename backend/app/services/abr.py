"""Thin client around the free Australian Business Register JSON API.

ABR returns JSONP wrapped in `callback(...)`. We strip the wrapper and parse JSON.
Registration for the free GUID: https://abr.business.gov.au/Tools/WebServices
"""
from __future__ import annotations

import json
import logging
from typing import Optional, TypedDict

import httpx

from app.config import ABR_ENABLED, ABR_GUID

logger = logging.getLogger(__name__)

ABR_ENDPOINT = "https://abr.business.gov.au/json/AbnDetails.aspx"
ABR_NAME_ENDPOINT = "https://abr.business.gov.au/json/MatchingNames.aspx"
TIMEOUT_SECONDS = 5.0
NAME_SEARCH_TIMEOUT_SECONDS = 8.0
MAX_NAME_RESULTS = 20

# MatchingNames returns the ABN status as an opaque code rather than a label.
ABN_STATUS_CODES = {"0000000001": "Active", "0000000002": "Cancelled"}


class AbrUnavailable(Exception):
    """ABR could not be asked — not configured, or the request failed. Distinct
    from a miss, because callers that decide something from "not found" (a
    private sale's GST treatment) must not decide it from an outage."""


class AbrRecord(TypedDict, total=False):
    abn: str
    acn: Optional[str]
    name: str
    trading_names: list[str]
    status: Optional[str]
    status_from: Optional[str]
    entity_type: Optional[str]
    gst_registered: Optional[bool]
    gst_from: Optional[str]
    state: Optional[str]
    postcode: Optional[str]


class AbrNameMatch(TypedDict, total=False):
    abn: str
    name: str
    name_type: Optional[str]
    status: Optional[str]
    state: Optional[str]
    postcode: Optional[str]
    score: Optional[int]


def _strip_jsonp(text: str) -> Optional[dict]:
    """ABR wraps responses as `callback({...})`. Strip the wrapper and parse."""
    text = text.strip()
    start = text.find("(")
    end = text.rfind(")")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start + 1 : end])
    except json.JSONDecodeError:
        return None


def lookup_abn(abn: str, raise_errors: bool = False) -> Optional[AbrRecord]:
    """Look up an ABN against the public ABR. Returns None on miss or if ABR isn't configured.

    With ``raise_errors`` an unconfigured ABR or a failed request raises
    AbrUnavailable instead, so None means only "the register has no such ABN"."""
    if not ABR_ENABLED:
        if raise_errors:
            raise AbrUnavailable("ABN Lookup is not configured on this server")
        return None
    digits = "".join(ch for ch in (abn or "") if ch.isdigit())
    if len(digits) != 11:
        return None

    try:
        resp = httpx.get(
            ABR_ENDPOINT,
            params={"abn": digits, "guid": ABR_GUID, "callback": "callback"},
            timeout=TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("ABR lookup failed for %s: %s", digits, exc)
        if raise_errors:
            raise AbrUnavailable("ABN Lookup could not be reached") from exc
        return None

    payload = _strip_jsonp(resp.text)
    if not payload:
        if raise_errors:
            raise AbrUnavailable("ABN Lookup returned an unreadable response")
        return None

    # ABR returns an empty record (Abn="") when nothing is found, sometimes with a Message.
    returned_abn = (payload.get("Abn") or "").strip()
    if not returned_abn:
        return None

    business_names = payload.get("BusinessName")
    if isinstance(business_names, str):
        trading_names = [business_names] if business_names else []
    elif isinstance(business_names, list):
        trading_names = [n for n in business_names if n]
    else:
        trading_names = []

    # ABR returns the GST registration start date while the registration is live and
    # clears the field once it is cancelled, so an empty value on a record we did find
    # means "not registered" rather than "unknown".
    gst_registered: Optional[bool] = bool((payload.get("Gst") or "").strip())

    # AbnStatusEffectiveFrom dates the CURRENT status, so it only reads as "ABN
    # held since" while the ABN is active — on a cancelled ABN it is the
    # cancellation date. Left null otherwise rather than handing callers a date
    # that means the opposite of what they'd assume.
    status = (payload.get("AbnStatus") or "").strip() or None
    status_from = (payload.get("AbnStatusEffectiveFrom") or "").strip() or None
    if status != "Active":
        status_from = None

    # ABR returns Acn only for entity types that have one (a company); it's blank
    # for sole traders, trusts and government entities.
    return AbrRecord(
        abn=returned_abn,
        acn=(payload.get("Acn") or "").strip() or None,
        name=(payload.get("EntityName") or "").strip(),
        trading_names=trading_names,
        status=status,
        status_from=status_from,
        entity_type=(payload.get("EntityTypeName") or "").strip() or None,
        gst_registered=gst_registered,
        gst_from=(payload.get("Gst") or "").strip() or None,
        state=(payload.get("AddressState") or "").strip() or None,
        postcode=(payload.get("AddressPostcode") or "").strip() or None,
    )

def search_names(query: str, limit: int = 10) -> list[AbrNameMatch]:
    """Search the ABR by entity, business or trading name.

    Returns the best match per ABN (an entity can match on several of its names),
    active ABNs first. Returns [] on a miss or if ABR isn't configured.
    """
    if not ABR_ENABLED:
        return []
    term = (query or "").strip()
    if len(term) < 3:
        return []
    limit = max(1, min(limit, MAX_NAME_RESULTS))

    try:
        resp = httpx.get(
            ABR_NAME_ENDPOINT,
            params={
                "name": term,
                "guid": ABR_GUID,
                "callback": "callback",
                # Ask for extra rows so de-duping by ABN can still fill `limit`.
                "maxResults": min(limit * 3, MAX_NAME_RESULTS * 3),
            },
            timeout=NAME_SEARCH_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("ABR name search failed for %r: %s", term, exc)
        return []

    payload = _strip_jsonp(resp.text)
    if not payload:
        return []

    rows = payload.get("Names")
    if not isinstance(rows, list):
        return []

    # An ABN appears once per matching name; keep only its highest-scoring row.
    best: dict[str, AbrNameMatch] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        abn = (row.get("Abn") or "").strip()
        name = (row.get("Name") or "").strip()
        if not abn or not name:
            continue
        try:
            score = int(row.get("Score"))
        except (TypeError, ValueError):
            score = 0
        existing = best.get(abn)
        if existing and (existing.get("score") or 0) >= score:
            continue
        best[abn] = AbrNameMatch(
            abn=abn,
            name=name,
            name_type=(row.get("NameType") or "").strip() or None,
            status=ABN_STATUS_CODES.get((row.get("AbnStatus") or "").strip()),
            state=(row.get("State") or "").strip() or None,
            postcode=(row.get("Postcode") or "").strip() or None,
            score=score,
        )

    matches = sorted(
        best.values(),
        key=lambda m: (m.get("status") != "Active", -(m.get("score") or 0), m.get("name") or ""),
    )
    return matches[:limit]


# ── History ──────────────────────────────────────────────────────────────

ABR_XML_ENDPOINT = "https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/SearchByABNv202001"
HISTORY_TIMEOUT_SECONDS = 10.0
_NS = "{http://abr.business.gov.au/ABRXMLSearch/}"
# The register's "no end date": the period is still current.
_OPEN_ENDED = "0001-01-01"


def _date(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return None if not value or value == _OPEN_ENDED else value


def _periods(entity, tag: str, value_of) -> list[dict]:
    """Every <tag> period as {value…, from, to}, newest first (to=None = current)."""
    out = []
    for el in entity.findall(f"{_NS}{tag}"):
        row = value_of(el)
        if row is None:
            continue
        row["from"] = _date(el.findtext(f"{_NS}effectiveFrom"))
        row["to"] = _date(el.findtext(f"{_NS}effectiveTo"))
        out.append(row)
    # Current periods first, then the rest newest first.
    current = sorted((r for r in out if r["to"] is None), key=lambda r: r["from"] or "", reverse=True)
    past = sorted((r for r in out if r["to"] is not None), key=lambda r: r["to"] or "", reverse=True)
    return current + past


def _join(periods: list[dict], same) -> list[dict]:
    """Merge back-to-back periods the register split for no visible reason (an
    Active period ending the day the next Active one starts). Newest first."""
    out: list[dict] = []
    for p in sorted(periods, key=lambda r: r["from"] or ""):
        if out and same(out[-1], p) and out[-1]["to"] is not None and out[-1]["to"] == p["from"]:
            out[-1]["to"] = p["to"]
            continue
        out.append(dict(p))
    out.reverse()
    return out


def _org_name(el) -> Optional[dict]:
    name = (el.findtext(f"{_NS}organisationName") or "").strip()
    return {"name": name} if name else None


def _person_name(el) -> Optional[dict]:
    parts = [el.findtext(f"{_NS}{t}") for t in ("givenName", "otherGivenName", "familyName")]
    name = " ".join(p.strip() for p in parts if p and p.strip())
    return {"name": name} if name else None


def parse_history(xml_text: str) -> Optional[dict]:
    """The register's history of one ABN, from a SearchByABNv202001 response
    with historical details. None when the register has no such ABN. Never
    keeps the raw response — it echoes our GUID back."""
    import xml.etree.ElementTree as ET

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        raise AbrUnavailable("ABN Lookup returned an unreadable response")
    response = root.find(f"{_NS}response")
    if response is None:
        raise AbrUnavailable("ABN Lookup returned an unreadable response")
    if response.find(f"{_NS}exception") is not None:
        return None
    entity = response.find(f"{_NS}businessEntity202001")
    if entity is None:
        return None

    abn_el = entity.find(f"{_NS}ABN")
    names = _periods(entity, "mainName", _org_name) + _periods(entity, "legalName", _person_name)
    statuses = _join(
        _periods(entity, "entityStatus", lambda el: {"status": (el.findtext(f"{_NS}entityStatusCode") or "").strip() or None}),
        lambda a, b: a["status"] == b["status"],
    )
    gst = _join(_periods(entity, "goodsAndServicesTax", lambda el: {}), lambda a, b: True)
    trading = _periods(entity, "mainTradingName", _org_name) + _periods(entity, "otherTradingName", _org_name)
    business_names = _periods(entity, "businessName", _org_name)
    addresses = _periods(entity, "mainBusinessPhysicalAddress", lambda el: {
        "state": (el.findtext(f"{_NS}stateCode") or "").strip() or None,
        "postcode": (el.findtext(f"{_NS}postcode") or "").strip() or None,
    })
    # The register re-dates an address on every edit; only real moves matter.
    moves = _join(addresses, lambda a, b: (a["state"], a["postcode"]) == (b["state"], b["postcode"]))

    # Collapse the same trading name registered more than once.
    seen: set[tuple] = set()
    trading = [t for t in trading if not ((t["name"].lower(), t["from"], t["to"]) in seen or seen.add((t["name"].lower(), t["from"], t["to"])))]

    starts = [s["from"] for s in statuses if s["from"]]
    return {
        "abn": (abn_el.findtext(f"{_NS}identifierValue") or "").strip() if abn_el is not None else None,
        "record_last_updated": _date(entity.findtext(f"{_NS}recordLastUpdatedDate")),
        "entity_type": (entity.findtext(f"{_NS}entityType/{_NS}entityDescription") or "").strip() or None,
        # When the ABN was first registered — the earliest status period.
        "first_registered": min(starts) if starts else None,
        "status_history": statuses,
        "gst_history": gst,
        "name_history": names,
        "trading_names": trading,
        "business_names": business_names,
        "address_history": moves,
    }


def lookup_abn_history(abn: str) -> Optional[dict]:
    """The register's full history of an ABN (names, status and GST periods,
    trading and business names, state moves). None when the register has no
    such ABN; AbrUnavailable when it can't be asked."""
    if not ABR_ENABLED:
        raise AbrUnavailable("ABN Lookup is not configured on this server")
    digits = "".join(ch for ch in (abn or "") if ch.isdigit())
    if len(digits) != 11:
        return None
    try:
        resp = httpx.get(
            ABR_XML_ENDPOINT,
            params={"searchString": digits, "includeHistoricalDetails": "Y", "authenticationGuid": ABR_GUID},
            timeout=HISTORY_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("ABR history lookup failed for %s: %s", digits, exc)
        raise AbrUnavailable("ABN Lookup could not be reached") from exc
    return parse_history(resp.text)
