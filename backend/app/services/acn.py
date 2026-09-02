"""ACN and ABN check-digit validation.

Both numbers carry their own checksum, so a typo can be caught without asking
anyone — which matters because ASIC's company register has no per-record API we
can query (ASIC paused new digital-service-provider applications until 2027, and
the only free copy of the register is a ~400MB weekly bulk file). Validating the
checksum and the ABN/ACN relationship is what we can do offline.

NOTE: frontend copy at frontend/src/lib/acn.ts — keep in sync.
"""
from __future__ import annotations

from typing import Optional

# ACN: the ninth digit is a complement check digit over the first eight.
_ACN_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 1)
# ABN: subtract 1 from the leading digit, then the weighted sum is divisible by 89.
_ABN_WEIGHTS = (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19)

# Entity types whose ABN is issued against their own ACN, so the two must agree.
# A trust may *record* an ACN — its corporate trustee's — which its own ABN does
# not encode, so a trust is deliberately not cross-checked.
ACN_BEARING_ENTITY_TYPES = frozenset({"company", "trustee"})


def digits_only(value: Optional[str]) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def normalize_acn(value: Optional[str]) -> Optional[str]:
    """Strip formatting. Returns None for blank input; does not validate."""
    return digits_only(value) or None


def is_valid_acn(value: Optional[str]) -> bool:
    """True when `value` is nine digits with a correct check digit."""
    d = digits_only(value)
    if len(d) != 9:
        return False
    total = sum(int(d[i]) * _ACN_WEIGHTS[i] for i in range(8))
    return (10 - total % 10) % 10 == int(d[8])


def is_valid_abn(value: Optional[str]) -> bool:
    """True when `value` is eleven digits satisfying the ABN modulus-89 check."""
    d = digits_only(value)
    if len(d) != 11:
        return False
    total = (int(d[0]) - 1) * _ABN_WEIGHTS[0]
    total += sum(int(d[i]) * _ABN_WEIGHTS[i] for i in range(1, 11))
    return total % 89 == 0


def format_acn(value: Optional[str]) -> Optional[str]:
    """051775556 -> "051 775 556" (the way an ACN is written down)."""
    d = digits_only(value)
    if len(d) != 9:
        return value or None
    return f"{d[:3]} {d[3:6]} {d[6:]}"


def acn_from_abn(abn: Optional[str]) -> Optional[str]:
    """A company's ABN is two check digits followed by its nine-digit ACN, so the
    ACN reads straight off it. Returns None unless the ABN itself is valid — a
    mistyped ABN would otherwise yield a confident, wrong ACN.

    The caller decides whether the entity *has* an ACN: a trust, partnership or
    sole trader's ABN is not built from one. See ``ACN_BEARING_ENTITY_TYPES``.
    """
    if not is_valid_abn(abn):
        return None
    return digits_only(abn)[2:]


def abn_encodes_acn(abn: Optional[str], acn: Optional[str]) -> Optional[bool]:
    """Whether `abn`'s embedded ACN matches `acn`.

    Returns None when the question can't be answered — either number missing or
    malformed — so a caller can tell "disagree" from "nothing to compare".
    """
    derived = acn_from_abn(abn)
    normalized = normalize_acn(acn)
    if not derived or not normalized or not is_valid_acn(normalized):
        return None
    return derived == normalized


def validation_error(
    acn: Optional[str],
    abn: Optional[str] = None,
    entity_type: Optional[str] = None,
) -> Optional[str]:
    """Explain what's wrong with an ACN, or None if it's fine.

    Blank is fine — an ACN is optional everywhere it's captured. The ABN
    cross-check only runs for entity types that carry their own ACN.
    """
    normalized = normalize_acn(acn)
    if not normalized:
        return None
    if len(normalized) != 9:
        return f"An ACN is 9 digits — got {len(normalized)}"
    if not is_valid_acn(normalized):
        return "That ACN's check digit doesn't match — it looks like a typo"
    if entity_type in ACN_BEARING_ENTITY_TYPES and abn_encodes_acn(abn, normalized) is False:
        return (
            f"This ACN doesn't match the ABN — a company's ABN ends in its ACN, "
            f"so the ABN given implies ACN {format_acn(acn_from_abn(abn))}"
        )
    return None
