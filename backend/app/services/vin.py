"""Asset identifier rules shared by every field that holds one.

An asset is identified one of two ways:

* **VIN** — the 17-character ISO 3779 identifier. Spaces are dropped and
  letters uppercased, and it must be *exactly* 17: a short one is a typo or a
  partial chassis number, and one longer than 17 is usually a rego or a second
  VIN stuck on the end ("YV5…096/DMMD8"). Either way it comes back to the desk
  to fix instead of being stored wrong.
* **Serial number** — for boats, trailers, equipment and anything else without
  a VIN (hull numbers, serial plates, engine numbers). Any length. Because a
  serial number alone says little, it must come with asset notes: what the
  asset is and where it is coming from (private sale or dealer).

`identifier_type` is "vin" or "serial"; a record without one is a VIN record
(everything written before the choice existed).
"""
from __future__ import annotations

import json
from typing import Optional

VIN_LENGTH = 17

IDENTIFIER_VIN = "vin"
IDENTIFIER_SERIAL = "serial"
IDENTIFIER_TYPES = (IDENTIFIER_VIN, IDENTIFIER_SERIAL)

NOTES_REQUIRED_MESSAGE = (
    "Asset notes are required with a serial number — say what the asset is "
    "and where it is coming from (private sale or dealer)"
)
SERIAL_REQUIRED_MESSAGE = "Serial / hull number is required"


def _vin_length_message(length: int) -> str:
    return (
        f"VIN must be exactly {VIN_LENGTH} characters ({length} entered) — "
        "use Serial number for boats, trailers and other assets without a VIN"
    )


def normalise_vin(value: Optional[str]) -> Optional[str]:
    """One VIN, cleaned and length-checked. Blank → None."""
    if value is None:
        return None
    v = "".join(value.split()).upper()
    if not v:
        return None
    if len(v) != VIN_LENGTH:
        raise ValueError(_vin_length_message(len(v)))
    return v


def valid_vin_or_none(value) -> Optional[str]:
    """For auto-fill from older data: the VIN if it passes the rule, else None
    so the desk fills it in rather than inheriting a malformed one."""
    if not isinstance(value, str):
        return None
    try:
        return normalise_vin(value)
    except ValueError:
        return None


def normalise_vin_lines(value: Optional[str]) -> Optional[str]:
    """One VIN per line (a schedule line can cover several assets)."""
    if value is None:
        return None
    lines = [normalise_vin(line) for line in value.splitlines()]
    kept = [line for line in lines if line]
    return "\n".join(kept) or None


def clean_text(value: Optional[str]) -> Optional[str]:
    """Trimmed free text (serial numbers, asset notes). Blank → None."""
    if value is None:
        return None
    v = str(value).strip()
    return v or None


def normalise_serial_lines(value: Optional[str]) -> Optional[str]:
    """One serial / hull number per line, each trimmed; blank lines dropped."""
    if value is None:
        return None
    kept = [line.strip() for line in value.splitlines() if line.strip()]
    return "\n".join(kept) or None


def normalise_identifier_type(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if value not in IDENTIFIER_TYPES:
        raise ValueError(f"identifier_type must be one of: {', '.join(IDENTIFIER_TYPES)}")
    return value


def identifier_problems(
    identifier_type: Optional[str],
    vin: Optional[str],
    serial_number: Optional[str],
    notes: Optional[str],
    *,
    vin_required: bool = False,
) -> list[str]:
    """What is wrong with an identifier taken as a whole (VIN length is
    checked where the VIN is normalised). Empty list = fine."""
    if (identifier_type or IDENTIFIER_VIN) == IDENTIFIER_SERIAL:
        problems = []
        if not clean_text(serial_number):
            problems.append(SERIAL_REQUIRED_MESSAGE)
        if not clean_text(notes):
            problems.append(NOTES_REQUIRED_MESSAGE)
        return problems
    if vin_required and not clean_text(vin):
        return ["VIN is required — or choose Serial number for an asset without a VIN"]
    return []


# ── The asset block inside an application's lend_extra_data ──────────────

_ASSET_BLOCKS = ("vehicle_details", "asset_details")


def _asset_blocks(blob: Optional[str]) -> dict[str, dict]:
    if not blob:
        return {}
    try:
        details = json.loads(blob).get("loan_type_details") or {}
    except (ValueError, AttributeError):
        return {}
    if not isinstance(details, dict):
        return {}
    return {k: details[k] for k in _ASSET_BLOCKS if isinstance(details.get(k), dict)}


def _block_identifier(block: dict) -> tuple:
    return (
        block.get("identifier_type") or IDENTIFIER_VIN,
        "".join(str(block.get("vin") or "").split()).upper(),
        clean_text(block.get("serial_number")),
        clean_text(block.get("identifier_notes")),
    )


def check_application_assets(new_blob: Optional[str], old_blob: Optional[str] = None) -> None:
    """Refuse an application asset block whose identifier breaks the rules.

    Only an identifier that *changed* is checked: staff edits elsewhere on the
    application send the whole blob back, and a VIN saved before the
    exactly-17 rule must not block an unrelated save. Raises ValueError."""
    old = _asset_blocks(old_blob)
    for key, block in _asset_blocks(new_blob).items():
        ident = _block_identifier(block)
        if key in old and _block_identifier(old[key]) == ident:
            continue
        identifier_type, vin, serial, notes = ident
        if identifier_type not in IDENTIFIER_TYPES:
            raise ValueError(f"identifier_type must be one of: {', '.join(IDENTIFIER_TYPES)}")
        if identifier_type == IDENTIFIER_VIN and vin and len(vin) != VIN_LENGTH:
            raise ValueError(_vin_length_message(len(vin)))
        problems = identifier_problems(identifier_type, vin, serial, notes)
        if problems:
            raise ValueError(problems[0])


def application_identifier(asset: dict) -> dict:
    """The identifier of a merged application asset block (see
    loan_category.application_asset_details), for prefilling other records.
    A VIN that fails the rule is dropped so the desk re-keys it."""
    identifier_type = asset.get("identifier_type") or IDENTIFIER_VIN
    if identifier_type == IDENTIFIER_SERIAL:
        return {
            "identifier_type": IDENTIFIER_SERIAL,
            "vin": None,
            "serial_number": clean_text(asset.get("serial_number")),
            "identifier_notes": clean_text(asset.get("identifier_notes")),
        }
    return {
        "identifier_type": IDENTIFIER_VIN,
        "vin": valid_vin_or_none(asset.get("vin")),
        "serial_number": None,
        "identifier_notes": None,
    }
