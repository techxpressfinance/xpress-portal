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
TIMEOUT_SECONDS = 5.0


class AbrRecord(TypedDict, total=False):
    abn: str
    name: str
    trading_names: list[str]
    status: Optional[str]
    entity_type: Optional[str]
    gst_registered: Optional[bool]
    state: Optional[str]
    postcode: Optional[str]


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

    gst_raw = (payload.get("Gst") or "").strip()
    gst_registered: Optional[bool]
    if not gst_raw:
        gst_registered = None
    else:
        # ABR returns a registration date string if registered, or "" if not
        gst_registered = True

    return AbrRecord(
        abn=returned_abn,
        name=(payload.get("EntityName") or "").strip(),
        trading_names=trading_names,
        status=(payload.get("AbnStatus") or "").strip() or None,
        entity_type=(payload.get("EntityTypeName") or "").strip() or None,
        gst_registered=gst_registered,
        state=(payload.get("AddressState") or "").strip() or None,
        postcode=(payload.get("AddressPostcode") or "").strip() or None,
    )
