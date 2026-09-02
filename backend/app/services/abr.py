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


class AbrRecord(TypedDict, total=False):
    abn: str
    acn: Optional[str]
    name: str
    trading_names: list[str]
    status: Optional[str]
    entity_type: Optional[str]
    gst_registered: Optional[bool]
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


def lookup_abn(abn: str) -> Optional[AbrRecord]:
    """Look up an ABN against the public ABR. Returns None on miss or if ABR isn't configured."""
    if not ABR_ENABLED:
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
        return None

    payload = _strip_jsonp(resp.text)
    if not payload:
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

    # ABR returns Acn only for entity types that have one (a company); it's blank
    # for sole traders, trusts and government entities.
    return AbrRecord(
        abn=returned_abn,
        acn=(payload.get("Acn") or "").strip() or None,
        name=(payload.get("EntityName") or "").strip(),
        trading_names=trading_names,
        status=(payload.get("AbnStatus") or "").strip() or None,
        entity_type=(payload.get("EntityTypeName") or "").strip() or None,
        gst_registered=gst_registered,
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
