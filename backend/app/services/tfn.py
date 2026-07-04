"""Tax File Number detection and redaction.

TFNs must not be stored or disclosed except as permitted by the Privacy
(Tax File Number) Rule 2015. OCR of tax returns / ATO notices can capture
them, so all OCR output is redacted before storage or any external call.

Only checksum-valid 9-digit candidates are redacted, which keeps false
positives (ACNs, account numbers) to the ~9% that coincidentally pass the
TFN check digit — an acceptable cost for a redacted token in OCR text.
"""
from __future__ import annotations

import re

_TFN_WEIGHTS = (1, 4, 3, 7, 5, 8, 6, 9, 10)

# 9 digits in the common groupings: 123456789, 123 456 789, 123-456-789
_TFN_CANDIDATE = re.compile(r"\b(\d{3})[ \-]?(\d{3})[ \-]?(\d{3})\b")

REDACTION_MARKER = "[TFN REDACTED]"


def _is_valid_tfn(digits: str) -> bool:
    if len(digits) != 9 or len(set(digits)) == 1:
        return False
    return sum(int(d) * w for d, w in zip(digits, _TFN_WEIGHTS)) % 11 == 0


def redact_tfns(text: str) -> str:
    """Replace checksum-valid TFNs in free text with a redaction marker."""
    if not text:
        return text

    def _replace(match: re.Match) -> str:
        digits = "".join(match.groups())
        return REDACTION_MARKER if _is_valid_tfn(digits) else match.group(0)

    return _TFN_CANDIDATE.sub(_replace, text)
