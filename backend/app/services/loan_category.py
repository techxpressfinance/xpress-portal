"""Loan-category derivation for applications.

Applications store the form sub-type (car, refinance, new_fit_out, …) inside
the encrypted lend_extra_data JSON under loan_type_details, so category can't
be resolved in SQL — derive it in Python after loading rows. Keep the sub-type
→ category mapping in sync with categoryForSubType in
frontend/src/lib/constants.ts.
"""
from __future__ import annotations

import json
from typing import Optional

from app.models.loan_application import LoanApplication, LoanType

LOAN_CATEGORIES = ("asset_finance", "home_loan", "commercial")

_HOME_SUB_TYPES = frozenset({"purchase", "refinance"})
_ASSET_SUB_TYPES = frozenset({
    "car", "motorcycle", "caravan", "other_vehicle", "personal",
    "day_to_day_capital", "vehicles_or_transport",
})

# Fallback when an application has no recorded sub-type (LEND-mode or legacy
# rows): resolve from the stored LoanType enum. equipment_finance is produced
# by both asset-finance and commercial sub-types — treat sub-type-less rows as
# asset finance; business_loan catch-alls lean commercial.
_LOAN_TYPE_FALLBACK = {
    LoanType.personal: "asset_finance",
    LoanType.vehicle: "asset_finance",
    LoanType.equipment_finance: "asset_finance",
    LoanType.home: "home_loan",
    LoanType.home_loan: "home_loan",
    LoanType.business: "commercial",
    LoanType.business_loan: "commercial",
    LoanType.commercial_property: "commercial",
}

# SQL prefilter: loan_type values a category's applications can be stored as
# (per subTypeToLoanType on the frontend). Overlaps between categories are
# resolved by the sub-type refinement in application_loan_category.
CATEGORY_LOAN_TYPES = {
    "asset_finance": (LoanType.personal, LoanType.vehicle, LoanType.equipment_finance, LoanType.business_loan),
    "home_loan": (LoanType.home, LoanType.home_loan),
    "commercial": (LoanType.business, LoanType.business_loan, LoanType.commercial_property, LoanType.equipment_finance),
}


def category_for_sub_type(sub_type: str) -> str:
    if sub_type in _HOME_SUB_TYPES:
        return "home_loan"
    if sub_type in _ASSET_SUB_TYPES:
        return "asset_finance"
    return "commercial"


def application_sub_type(app: LoanApplication) -> Optional[str]:
    """Form sub-type recorded at submission, or None for LEND/legacy rows."""
    if not app.lend_extra_data:
        return None
    try:
        details = json.loads(app.lend_extra_data).get("loan_type_details") or {}
    except (ValueError, AttributeError):
        return None
    for key in ("consumer_loan_type", "commercial_loan_type"):
        entry = details.get(key)
        if isinstance(entry, dict) and entry.get("type"):
            return entry["type"]
    return None


def application_loan_category(app: LoanApplication) -> Optional[str]:
    sub_type = application_sub_type(app)
    if sub_type:
        return category_for_sub_type(sub_type)
    return _LOAN_TYPE_FALLBACK.get(app.loan_type)
