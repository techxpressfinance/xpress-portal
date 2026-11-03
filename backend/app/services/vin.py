"""VIN rules shared by every field that holds one.

A VIN is the 17-character ISO 3779 identifier. Spaces are dropped and letters
uppercased; anything longer than 17 is refused rather than silently cut, so a
VIN pasted with a rego or a second VIN stuck on the end ("YV5…096/DMMD8")
comes back to the desk to fix instead of being stored wrong.
"""
from __future__ import annotations

from typing import Optional

VIN_LENGTH = 17


def normalise_vin(value: Optional[str]) -> Optional[str]:
    """One VIN, cleaned and length-checked. Blank → None."""
    if value is None:
        return None
    v = "".join(value.split()).upper()
    if not v:
        return None
    if len(v) > VIN_LENGTH:
        raise ValueError(f"VIN must be at most {VIN_LENGTH} characters ({len(v)} entered)")
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
