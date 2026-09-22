"""Totals, prefill and validation for a tax invoice.

Totals are always derived here, never taken from the client — a document that
claims a GST figure the line items don't support is worse than no document.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy.orm import Session

from app.models.contact import Contact, Organization
from app.models.loan_applicant import LoanApplicant
from app.models.loan_application import APPLICANT_TYPE_COMPANY, LoanApplication
from app.models.tax_invoice import (
    BUYER_IDENTITY_THRESHOLD,
    LENDER_OWNED_FACILITIES,
    AbnStatus,
    FacilityType,
    SupplierType,
    TaxInvoice,
)
from app.models.user import User, UserRole
from app.services import acn as acn_service
from app.services.activity_log import log_activity
from app.services.lender_pricing import latest_for_application as latest_lender_pricing
from app.services.loan_category import application_asset_details, application_loan_category

# GST is 1/11th of a GST-inclusive amount.
GST_DIVISOR = Decimal("11")

# A loan above this share of the asset's value is outside policy and worth a
# broker's second look. Expressed as a percentage because that is how the desk
# and every lender quote it.
LVR_POLICY_CAP = Decimal("110")

# Odometer bands that decide what the asset is sold as. A reading is objective
# where a seller's description is not, so it settles the question wherever one
# is recorded.
DEMO_ODOMETER_CEILING = 5_000
NEW_ODOMETER_CEILING = 500

# How long a valuation can be relied on — the "period of currency" valuers
# quote from the effective date.
VALUATION_CURRENCY_DAYS = 45

# Entity types whose ABN is issued against an ACN, so the ACN is the ABN's last
# nine digits. A trust, partnership or sole trader has no ACN to derive.
_ACN_ENTITY_TYPES = acn_service.ACN_BEARING_ENTITY_TYPES


def _money(value: Optional[Decimal]) -> Decimal:
    return Decimal(value or 0)


def _round(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def charges_gst(invoice: TaxInvoice) -> bool:
    """Whether this document may charge GST and call itself a tax invoice.

    A private seller only qualifies once ABN Lookup has shown an active ABN
    registered for GST; an ABN that cannot be found, is cancelled, or is active
    without GST makes the sale GST-free and the document a plain invoice. Other
    suppliers keep the broker's GST flag."""
    if invoice.supplier_type == SupplierType.private:
        return bool(invoice.supplier_gst_registered) and invoice.supplier_abn_status == AbnStatus.active.value
    return bool(invoice.supplier_gst_registered)


def totals(invoice: TaxInvoice) -> dict:
    """Cost of the goods, GST, and what is actually payable on settlement.

    Amounts are treated as GST-inclusive, which is how prices are quoted and
    written on Australian invoices. A supplier who is not registered for GST
    (typically a private seller) charges none, so the GST line is zero and the
    document must not present itself as a tax invoice.

    The payable figure follows the desk's request sheet: cash price, less any
    trade-in, plus the payout still owing on that trade-in, less the cash
    deposit already handed over."""
    subtotal = _money(invoice.sale_price) + _money(invoice.buyers_premium) + _money(invoice.other_charges)
    is_tax_invoice = charges_gst(invoice)
    gst = _round(subtotal / GST_DIVISOR) if is_tax_invoice else Decimal("0")
    trade_in = _money(invoice.trade_in_value)
    payout = _money(invoice.payout_amount)
    deposit = _money(invoice.deposit_paid)
    payable = _round(subtotal - trade_in + payout - deposit)

    # Settlement reaches two parties, not one, where the asset being bought
    # still carries finance: the payout clears that loan so the asset comes
    # over unencumbered, and the seller is paid whatever the price leaves. That
    # debt is already inside the price — unlike the trade-in payout above,
    # which is added to it — so the two parts split `payable` rather than
    # enlarging it.
    to_creditor = _round(_money(invoice.asset_payout_amount))
    to_seller = payable - to_creditor

    # A real test, not a restatement of the line above: the payout can be
    # quoted higher than the price the deal was written at, and then there is
    # nothing left for the seller and the settlement cannot be paid as
    # structured. That is the case the desk has to see before funds move.
    settlement_balances = to_seller >= 0

    # The deposit has already come off `payable`, so the amount financed is
    # that same figure — the two names are the lender's and the dealer's words
    # for one number, and taking the deposit off twice would understate the
    # advance.
    amount_financed = payable

    # The asset is valued at the third-party valuation's market value where
    # one was obtained, and otherwise at the cash price — then an LVR over 100%
    # means rolled-in negative equity or fees rather than an overpriced asset.
    asset_value = invoice.valuation_market_value or invoice.sale_price
    lvr = (
        _round(amount_financed / _round(_money(asset_value)) * 100)
        if asset_value
        else None
    )

    # What is still owing on the trade-in beyond what it is worth, carried into
    # the new loan.
    negative_equity = _round(payout - trade_in) if payout > trade_in else Decimal("0")

    return {
        "subtotal": float(_round(subtotal)),
        "gst": float(gst),
        # The GST-exclusive value of the goods, which is the figure a business
        # buyer carries into its books.
        "ex_gst": float(_round(subtotal) - gst),
        "total": float(_round(subtotal)),
        "trade_in": float(_round(trade_in)),
        "payout": float(_round(payout)),
        "asset_payout": float(to_creditor),
        "deposit_paid": float(_round(deposit)),
        # What the financier is asked to pay. Named balance_due since the
        # invoice documents also print it as the balance owing.
        "balance_due": float(payable),
        "amount_financed": float(amount_financed),
        # A price that a trade-in and a deposit between them more than cover is
        # an arithmetic impossibility on a finance deal, not a refund owing.
        "payable_is_negative": payable < 0,
        "settlement_to_creditor": float(to_creditor),
        "settlement_to_seller": float(to_seller),
        "settlement_total": float(to_creditor + to_seller),
        "settlement_balances": settlement_balances,
        "lvr": float(lvr) if lvr is not None else None,
        "lvr_basis": "valuation" if invoice.valuation_market_value else "cash_price",
        "negative_equity": float(negative_equity),
        # The heading the document may legally carry.
        "is_tax_invoice": is_tax_invoice,
        "buyer_identity_required": _round(subtotal) >= BUYER_IDENTITY_THRESHOLD,
    }


def classify_condition(odometer: Optional[int]) -> Optional[str]:
    """What the odometer says the asset is: new, a demo, or used.

    Only vehicles have one — equipment is metered in hours — so this returns
    nothing for an asset with no reading and the recorded description stands."""
    if odometer is None:
        return None
    if odometer <= NEW_ODOMETER_CEILING:
        return "new"
    if odometer <= DEMO_ODOMETER_CEILING:
        return "demo"
    return "used"


def _normalise_name(value: Optional[str]) -> Optional[str]:
    """A name reduced to the parts worth comparing: case, punctuation and word
    order dropped, so "SMITH, John" and "John Smith" are the same person and
    "Robert Smith" is not."""
    if not value:
        return None
    words = sorted(w for w in "".join(c if c.isalnum() else " " for c in value.lower()).split() if w)
    return " ".join(words) or None


def name_match(invoice: TaxInvoice) -> Optional[dict]:
    """Whether every document behind the sale names the same seller.

    The cheapest fraud check there is on a private sale: the person on the
    invoice, on the licence, on the registration and on the account the money
    lands in should all be one person. Returns None when there is nothing to
    compare — one name on its own agrees with itself and proves nothing."""
    sources = [
        ("Invoice name", invoice.supplier_name),
        ("Payout letter", invoice.payout_letter_name),
        ("Driver licence", invoice.licence_name),
        ("Registration", invoice.registration_name),
        ("Bank account", invoice.payout_account_name),
    ]
    present = [(label, raw, _normalise_name(raw)) for label, raw in sources if _normalise_name(raw)]
    if len(present) < 2:
        return None
    baseline = present[0][2]
    mismatched = [label for label, _raw, norm in present[1:] if norm != baseline]
    return {
        "checked": [label for label, _raw, _norm in present],
        "missing": [label for label, raw in sources if not _normalise_name(raw)],
        "mismatched": mismatched,
        "matches": not mismatched,
    }


def alerts(invoice: TaxInvoice, approved_amount: Optional[Decimal] = None) -> list[dict]:
    """Things worth a broker's attention before this document goes out.

    Mostly warnings. Negative equity and a high LVR describe deals the desk may
    still have good reason to write — an LVR outside policy is a referral point
    for a broker to find a lender whose policy fits, not a "no" to the client —
    so they never block issuing.

    The two arithmetic failures are different in kind: a negative payable or a
    settlement that cannot be paid as split are not risk judgements, they are
    sums that do not work, and `blockers` stops those."""
    found: list[dict] = []
    sums = totals(invoice)

    if sums["payable_is_negative"]:
        found.append({
            "code": "payable_negative",
            "message": (
                f"Total payable comes out at {_fmt_money(sums['balance_due'])} — the trade-in and "
                f"deposit together exceed the price. Check the cost build-up before going further."
            ),
        })

    if not sums["settlement_balances"]:
        found.append({"code": "settlement_unbalanced", "message": _payout_exceeds_message(sums)})

    if invoice.valuation_market_value and invoice.sale_price and invoice.sale_price > invoice.valuation_market_value:
        found.append({
            "code": "price_above_valuation",
            "message": (
                f"The cash price of {_fmt_money(float(invoice.sale_price))} is above the "
                f"{_fmt_money(float(invoice.valuation_market_value))} market valuation."
            ),
        })

    if invoice.valuation_date:
        age = (date.today() - invoice.valuation_date).days
        if age > VALUATION_CURRENCY_DAYS:
            found.append({
                "code": "valuation_expired",
                "message": (
                    f"The valuation is {age} days old — past its {VALUATION_CURRENCY_DAYS}-day "
                    f"period of currency. The lender may want it refreshed."
                ),
            })

    if sums["negative_equity"] > 0:
        found.append({
            "code": "negative_equity",
            "message": (
                f"Negative equity of {_fmt_money(sums['negative_equity'])} — the payout on the "
                f"trade-in exceeds what it is worth and is being carried into the new loan."
            ),
        })

    if sums["lvr"] is not None and Decimal(str(sums["lvr"])) > LVR_POLICY_CAP:
        found.append({
            "code": "lvr",
            "message": (
                f"LVR of {sums['lvr']:.0f}% is above the {LVR_POLICY_CAP:.0f}% policy cap — "
                f"{_fmt_money(sums['amount_financed'])} financed against a "
                + (
                    f"{_fmt_money(float(invoice.valuation_market_value))} market valuation."
                    if sums["lvr_basis"] == "valuation"
                    else f"{_fmt_money(sums['subtotal'])} cash price."
                )
            ),
        })

    # The dealer has to invoice to the deal the lender approved. Where the two
    # figures have drifted apart, one of them is out of date and settling on
    # the wrong one leaves the financier short or the client overcommitted.
    if approved_amount is not None:
        variance = _round(Decimal(str(sums["amount_financed"])) - _round(approved_amount))
        if variance != 0:
            direction = "above" if variance > 0 else "below"
            found.append({
                "code": "finance_variance",
                "message": (
                    f"This invoice finances {_fmt_money(sums['amount_financed'])}, "
                    f"{_fmt_money(abs(float(variance)))} {direction} the "
                    f"{_fmt_money(float(approved_amount))} approved on the lender pricing. "
                    f"Re-price or correct the invoice before settlement."
                ),
            })

    names = name_match(invoice)
    if names and not names["matches"]:
        found.append({
            "code": "name_mismatch",
            "message": (
                "The seller is named differently on " + ", ".join(names["mismatched"]) +
                " than on the invoice. Confirm who owns the asset and who is being paid "
                "before releasing funds."
            ),
        })

    return found


def _payout_exceeds_message(sums: dict) -> str:
    """The desk's instruction for a payout the funding cannot cover: the seller
    pays their own lender down first, then the figure is corrected."""
    return (
        f"The payout of {_fmt_money(sums['settlement_to_creditor'])} is more than the "
        f"{_fmt_money(sums['balance_due'])} being funded. The seller must reduce their payout "
        f"to {_fmt_money(sums['balance_due'])} or less by paying their lender directly and send "
        f"proof of that payment — then enter the reduced payout and tick 'Seller reduced the payout'."
    )


def blockers(invoice: TaxInvoice) -> list[str]:
    """Sums that do not work, which stop the document being issued.

    Kept apart from `completeness` because these are not blanks a broker can
    fill in — they are figures that contradict each other — and apart from
    `alerts` because everything there is a judgement the desk is allowed to
    make."""
    stop: list[str] = []
    sums = totals(invoice)
    if sums["payable_is_negative"]:
        stop.append(
            f"Total payable is negative ({_fmt_money(sums['balance_due'])})"
        )
    if not sums["settlement_balances"]:
        stop.append(_payout_exceeds_message(sums))
    return stop


def _fmt_money(value: float) -> str:
    return f"${value:,.2f}"


def lender_owns_goods(invoice: TaxInvoice) -> bool:
    """Whether the financier, not the client, is buying from the dealer — true
    for every lease and for hire purchase. An unset facility reads as the
    client buying, which is what every request printed before the field
    existed."""
    try:
        return FacilityType(invoice.facility_type) in LENDER_OWNED_FACILITIES
    except ValueError:
        return False


def _client_party(invoice: TaxInvoice) -> dict:
    return {
        "name": invoice.buyer_name,
        "address": invoice.buyer_address,
        "abn": invoice.buyer_abn,
        "acn": invoice.buyer_acn,
    }


def parties(invoice: TaxInvoice) -> dict:
    """Who the goods are sold to and who takes delivery, as printed.

    ``buyer_*`` always holds the client. On a chattel mortgage the client is
    both parties. On a lease or hire purchase the lender buys the goods, so it
    is Sold To — by name and address only, it is not the one being identified —
    and the client moves to Delivery To. A Delivery To typed separately (a site
    rather than the client's address) wins over either."""
    client = _client_party(invoice)
    # Only the dealer request moves the lender into Sold To. The invoice this
    # desk raises for a private or auction sale is unchanged.
    if invoice.supplier_type == SupplierType.dealer and lender_owns_goods(invoice):
        lender = invoice.lender
        sold_to = {
            "name": lender.name if lender else None,
            "address": lender.address if lender else None,
            "abn": None,
            "acn": None,
        }
    else:
        sold_to = client
    deliver_to = client if invoice.delivery_same_as_buyer else {
        "name": invoice.delivery_name,
        "address": invoice.delivery_address,
        "abn": invoice.delivery_abn,
        "acn": invoice.delivery_acn,
    }
    return {"sold_to": sold_to, "deliver_to": deliver_to}


# The goods rows a dealer's tax invoice has to carry. Whatever the broker has
# not taken from a contract of sale prints blank for the dealer to fill in.
_DEALER_GOODS_FIELDS = [
    ("asset_condition", "New or used"),
    ("asset_year", "Year"),
    ("asset_make", "Make"),
    ("asset_model", "Model (full details)"),
    ("asset_vin", "VIN or chassis number"),
    ("asset_engine_number", "Engine number"),
    ("asset_build_date", "Build date"),
    ("asset_compliance_date", "Compliance date"),
    ("asset_odometer", "Odometer"),
    ("asset_colour", "Colour"),
    ("asset_registration", "Registration"),
    ("asset_registration_expiry", "Registration expiry"),
]


def dealer_to_supply(invoice: TaxInvoice) -> list[str]:
    """What the dealer still has to provide on their tax invoice.

    The request goes out with gaps on purpose — a broker without a contract of
    sale leaves the goods blank and the dealer completes them. The GST
    component, the dealer's ABN and their bank account always come back from
    the dealer, so those are listed whatever the broker has typed."""
    if invoice.supplier_type != SupplierType.dealer:
        return []
    needed = [label for field, label in _DEALER_GOODS_FIELDS if getattr(invoice, field) in (None, "")]
    needed += [
        "Dealer's ABN",
        "Tax invoice number",
        "GST component of the cash price",
        "Dealer's bank account for settlement",
    ]
    return needed


# What the desk collects from a private seller before the invoice can go out:
# (key, label, when it is required). Order is the order the desk asks.
SELLER_DOCUMENTS: list[tuple[str, str]] = [
    ("registration", "Registration certificate"),
    ("payout_letter", "Payout letter"),
    ("ppsr_certificate", "PPSR certificate"),
    ("ppsr_release", "Signed PPSR release and deed of release"),
    ("inspection", "Third-party vehicle inspection (we arrange)"),
    ("bank_statement", "Seller's bank statement (for the lender to pay the seller)"),
    ("valuation", "Valuation certificate (we arrange with the valuer)"),
    ("payout_proof", "Proof of the seller's payment to their lender"),
]
SELLER_DOCUMENT_KEYS = frozenset(k for k, _ in SELLER_DOCUMENTS)


def seller_documents_received(invoice: TaxInvoice) -> dict[str, bool]:
    try:
        stored = json.loads(invoice.seller_documents or "{}")
    except ValueError:
        stored = {}
    return {k: bool(stored.get(k)) for k in SELLER_DOCUMENT_KEYS}


def seller_checklist(invoice: TaxInvoice) -> list[dict]:
    """The private-sale document checklist, each item marked required or not by
    the deal's own facts: a payout letter only when the car is under finance, a
    PPSR certificate only when there is a charge, a deed of release only for an
    ALL PAP charge, a valuation only when the broker says one is needed."""
    if invoice.supplier_type != SupplierType.private:
        return []
    received = seller_documents_received(invoice)
    under_finance = _money(invoice.asset_payout_amount) > 0
    required = {
        "registration": True,
        "payout_letter": under_finance,
        "ppsr_certificate": invoice.ppsr_charge is True,
        "ppsr_release": invoice.ppsr_charge is True and invoice.ppsr_all_pap is True,
        "inspection": True,
        "bank_statement": True,
        "valuation": invoice.valuation_needed is True,
        "payout_proof": under_finance and invoice.payout_reduced,
    }
    return [
        {"key": key, "label": label, "required": required[key], "received": received[key]}
        for key, label in SELLER_DOCUMENTS
    ]


def expected_seller_name(invoice: TaxInvoice) -> Optional[str]:
    """Who a private-sale invoice is issued by: the name on the payout letter
    where the car is under finance, else the registered owner."""
    if _money(invoice.asset_payout_amount) > 0 and invoice.payout_letter_name:
        return invoice.payout_letter_name
    return invoice.registration_name or invoice.payout_letter_name


def document_title(invoice: TaxInvoice) -> str:
    if invoice.supplier_type == SupplierType.dealer:
        return "Tax invoice request"
    if invoice.supplier_type == SupplierType.private:
        return "Private sale tax invoice" if charges_gst(invoice) else "Private sale invoice"
    return "Tax invoice" if charges_gst(invoice) else "Invoice"


def completeness(invoice: TaxInvoice) -> list[str]:
    """What still has to be filled in before this can be issued. Returned rather
    than raised so the form can show every gap at once.

    A dealer document is a *request* — we are asking the dealer to send their
    tax invoice, so their ABN and invoice number are what comes back, not what
    we supply. What it must carry instead is the parties, the money and where to
    reply. The goods are identified as far as the broker knows them; anything
    left blank is for the dealer to complete (see `dealer_to_supply`)."""
    missing: list[str] = []
    sums = totals(invoice)

    if not invoice.supplier_name:
        missing.append("Supplier name")
    if not invoice.invoice_date:
        missing.append("Invoice date")
    if invoice.supplier_type != SupplierType.dealer and not invoice.asset_description and not (
        invoice.asset_make or invoice.asset_model
    ):
        missing.append("Description of what is being sold")
    if not invoice.sale_price:
        missing.append("Sale price")

    if invoice.supplier_type == SupplierType.dealer:
        if not invoice.attention and not invoice.supplier_email:
            missing.append("Who at the dealership this is addressed to (attention or email)")
        if not invoice.facility_type:
            missing.append("Facility type (chattel mortgage, lease or hire purchase)")
        if lender_owns_goods(invoice):
            # The lender buys the goods, so it is the party the dealer invoices.
            if not invoice.lender_id:
                missing.append("Financier — the dealer invoices the lender on a lease or hire purchase")
            elif not (invoice.lender and invoice.lender.address):
                missing.append("Lender's address — add it to the lender in the lender book")
            client_label = "Delivery To (client)"
        else:
            client_label = "Sold To (client)"
            # A chattel mortgage is business finance in the client's name: the
            # dealer's invoice has to identify the client by ABN.
            if not invoice.buyer_abn:
                missing.append("Client ABN — required on a chattel mortgage")
        if not invoice.buyer_name:
            missing.append(f"{client_label} name")
        if not invoice.buyer_address:
            missing.append(f"{client_label} address")
        if not invoice.delivery_same_as_buyer and not invoice.delivery_address:
            missing.append("Delivery To address")
        if not invoice.reply_to_email:
            missing.append("Email address for the dealer to send the tax invoice back to")
    else:
        if invoice.supplier_type != SupplierType.private and invoice.supplier_gst_registered and not invoice.supplier_abn:
            missing.append("Supplier ABN (required to charge GST)")
        if invoice.supplier_type == SupplierType.private:
            missing += _private_sale_gaps(invoice)
        if sums["buyer_identity_required"] and not (invoice.buyer_name or invoice.buyer_abn):
            missing.append("Buyer name or ABN (required at $1,000 or more)")
        if invoice.supplier_type == SupplierType.auction and invoice.buyers_premium is None:
            missing.append("Buyer's premium")

    # Settlement is paid in two parts where the asset carries finance, so the
    # first payee needs an account to be paid into. Without it the payout leg
    # has nowhere to go and the asset does not clear.
    if _money(invoice.asset_payout_amount) > 0 and not (
        invoice.payout_creditor_name and invoice.payout_creditor_account_number
    ):
        missing.append("Existing financier's name and account for the payout")
    return missing


def _private_sale_gaps(invoice: TaxInvoice) -> list[str]:
    """What a private sale still needs: the seller identified and checked on
    ABN Lookup, the client it is addressed and delivered to, the two yes/no
    prompts answered, and every document those answers call for."""
    gaps: list[str] = []
    if not invoice.supplier_address:
        gaps.append("Seller's address")
    if not invoice.supplier_abn_status:
        gaps.append("Seller's ABN — check it on ABN Lookup, or record that they have none")
    elif invoice.supplier_abn_status != AbnStatus.none.value and not invoice.supplier_abn:
        gaps.append("Seller's ABN")
    if not invoice.buyer_name:
        gaps.append("Client name")
    if not invoice.buyer_address:
        gaps.append("Client address")
    if not invoice.delivery_same_as_buyer and not invoice.delivery_address:
        gaps.append("Delivery address")
    if invoice.valuation_needed is None:
        gaps.append("Answer: is a valuation needed?")
    if invoice.ppsr_charge is None:
        gaps.append("Answer: is there a charge on the PPSR?")
    elif invoice.ppsr_charge and invoice.ppsr_all_pap is None:
        gaps.append("Answer: is the PPSR charge an ALL PAP charge?")
    if invoice.valuation_needed and not invoice.valuation_market_value:
        gaps.append("Valuation market value")
    if _money(invoice.asset_payout_amount) > 0 and not invoice.payout_letter_name:
        gaps.append("Seller's name as shown on the payout letter")
    gaps += [f"Received: {item['label']}" for item in seller_checklist(invoice) if item["required"] and not item["received"]]
    if not (invoice.payout_account_name and invoice.payout_account_number):
        gaps.append("Seller's bank account (from their bank statement)")
    return gaps


def apply_abn_lookup(invoice: TaxInvoice, record: Optional[dict]) -> None:
    """Record an ABN Lookup result and let it decide the GST treatment: only an
    active ABN registered for GST can charge it. A miss is recorded as
    not_found — the caller must only pass None for a genuine miss, never for an
    outage (see abr.lookup_abn's raise_errors)."""
    invoice.supplier_abn_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if record is None:
        invoice.supplier_abn_status = AbnStatus.not_found.value
        invoice.supplier_abn_name = None
        invoice.supplier_gst_registered = False
        return
    active = record.get("status") == "Active"
    invoice.supplier_abn_status = AbnStatus.active.value if active else AbnStatus.cancelled.value
    invoice.supplier_abn_name = record.get("name") or None
    invoice.supplier_gst_registered = bool(active and record.get("gst_registered"))
    if record.get("acn"):
        invoice.supplier_acn = record["acn"]


def acn_from_abn(abn: Optional[str], entity_type: Optional[str]) -> Optional[str]:
    """A company's ABN is two check digits followed by its nine-digit ACN, so
    the ACN can be read straight off it. Only for entities that have one — a
    trust or sole trader's ABN is not built from an ACN. A malformed ABN yields
    nothing rather than a plausible-looking wrong ACN on the invoice."""
    if entity_type not in _ACN_ENTITY_TYPES:
        return None
    return acn_service.acn_from_abn(abn)


def _text(value) -> Optional[str]:
    """Blank strings are recorded by the form when a field was skipped — they
    are absence, not an answer."""
    text = str(value).strip() if value is not None else ""
    return text or None


def _int(value) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(Decimal(str(value)))
    except (ArithmeticError, ValueError):
        return None


def _decimal(value) -> Optional[Decimal]:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError):
        return None


def _address_block(street: object, suburb: object, state: object, postcode: object) -> Optional[str]:
    """Street on one line, suburb/state/postcode on the next — the shape the
    request sheet's address blocks are laid out in."""
    street = _text(street)
    locality = " ".join(p for p in [_text(suburb), _text(state)] if p)
    postcode = _text(postcode)
    second = ", ".join(p for p in [locality, postcode] if p) if locality else postcode
    return "\n".join(p for p in [street, second] if p) or None


def _applicant_address(application: LoanApplication) -> Optional[str]:
    return _address_block(
        application.applicant_address,
        application.applicant_suburb,
        application.applicant_state,
        application.applicant_postcode,
    )


def _first(*values: object) -> Optional[str]:
    """The first of these that holds anything."""
    for value in values:
        text = _text(value)
        if text:
            return text
    return None


def _person_from_application(db: Session, application: LoanApplication) -> dict:
    """The individual behind the application — name and address.

    Three places hold this and which one is filled depends on how the file was
    made. The client-facing form writes the application's own applicant_*
    columns; a commercial deal carries its people as loan_applicant rows and
    names the primary one there; a staff-made or entity-first application often
    has neither and only the contact card behind contact_id.

    Each field takes the first source that answers it rather than the first
    source that answers anything, so a half-filled form still completes from
    the contact card instead of leaving the block blank. They describe the same
    person — contact_id is this application's client — so mixing them is safe.
    """
    primary = (
        db.query(LoanApplicant)
        .filter(LoanApplicant.application_id == application.id, LoanApplicant.is_primary.is_(True))
        .first()
    )
    contact = (
        db.query(Contact).filter(Contact.id == application.contact_id).first()
        if application.contact_id
        else None
    )

    first_name = _first(
        application.applicant_first_name,
        primary.applicant_first_name if primary else None,
        contact.first_name if contact else None,
    )
    last_name = _first(
        application.applicant_last_name,
        primary.applicant_last_name if primary else None,
        contact.last_name if contact else None,
    )
    address = _first(
        _applicant_address(application),
        _address_block(
            primary.applicant_address, primary.applicant_suburb,
            primary.applicant_state, primary.applicant_postcode,
        ) if primary else None,
        _address_block(contact.address, contact.suburb, contact.state, contact.postcode)
        if contact
        else None,
    )
    return {
        "name": " ".join(p for p in [first_name, last_name] if p).strip() or None,
        "address": address,
    }


def buyer_from_application(db: Session, application: LoanApplication) -> dict:
    """The Sold To party: name, ABN, ACN and address.

    Who that is, is the broker's call, recorded as ``applicant_type`` — a dealer
    releases goods to the company on the contract when the business is buying,
    but a sole trader financing in their own name buys as themselves even though
    an ABN is on the file. Each side falls back to the other rather than leaving
    the block empty: a company application with no entity on record still has a
    director to name, and an individual one may only have the business.
    """
    organization: Optional[Organization] = None
    if application.business_organization_id:
        organization = (
            db.query(Organization).filter(Organization.id == application.business_organization_id).first()
        )

    entity_name = _first(organization.name if organization else None, application.business_name)
    entity_abn = _first(organization.abn if organization else None, application.business_abn)
    entity_address = _text(organization.address if organization else None)
    person = _person_from_application(db, application)
    person_name = person["name"]
    person_address = person["address"]

    if application.applicant_type == APPLICANT_TYPE_COMPANY:
        buyer_name = entity_name or person_name
        buyer_abn = entity_abn
        buyer_address = entity_address or person_address
    else:
        buyer_name = person_name or entity_name
        # A sole trader's ABN is their own, so it belongs on an invoice made out
        # to them. A company, trust or partnership is a separate legal person —
        # printing its ABN beside an individual's name misidentifies the buyer.
        entity_is_separate_person = (
            organization is not None
            and organization.entity_type is not None
            and organization.entity_type != "sole_trader"
        )
        buyer_abn = None if (person_name and entity_is_separate_person) else entity_abn
        buyer_address = person_address or entity_address

    return {
        "buyer_name": buyer_name,
        "buyer_abn": buyer_abn,
        # A recorded ACN (from the ABR) beats one inferred from the ABN, which
        # depends on entity_type being set and is silent when it is not.
        "buyer_acn": (
            (organization.acn if organization and buyer_abn else None)
            or acn_from_abn(buyer_abn, organization.entity_type if organization else None)
        ),
        "buyer_address": buyer_address,
    }


def pricing_facility(pricing) -> Optional[str]:
    """The facility the lender pricing was worked on, which lives only in its
    JSON inputs. The pricing editor knows chattel, hp and lease; a novated lease
    is chosen on the invoice itself."""
    if pricing is None or not pricing.input_parameters:
        return None
    try:
        value = json.loads(pricing.input_parameters).get("facility_type")
    except (ValueError, AttributeError):
        return None
    try:
        return FacilityType(value).value
    except ValueError:
        return None


def desk_recipients(db: Session, application: LoanApplication, actor_id: Optional[str] = None) -> list[str]:
    """Who the dealer's tax invoice goes to: the broker carrying the file and
    the tenant's administrators.

    The broker is the one chasing settlement; the admins book it. The actor is
    the fallback for a file with no assigned broker, so there is always someone
    on the file. Order is broker first, then admins, with duplicates dropped —
    an admin who is also the broker appears once."""
    emails: list[str] = []
    for user_id in (application.assigned_broker_id, actor_id):
        if not user_id:
            continue
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.email and user.is_active:
            emails.append(user.email)
            break
    admins = (
        db.query(User)
        .filter(
            User.tenant_id == application.tenant_id,
            User.role == UserRole.admin,
            User.is_active.is_(True),
        )
        .order_by(User.created_at)
        .all()
    )
    emails += [a.email for a in admins if a.email]
    unique: list[str] = []
    for email in emails:
        if email.lower() not in (u.lower() for u in unique):
            unique.append(email)
    return unique


def prefill_from_application(
    db: Session,
    application: LoanApplication,
    supplier_type: SupplierType,
    actor_id: Optional[str] = None,
) -> dict:
    """Everything about the invoice the application already answers.

    The asset block lives in the encrypted lend_extra_data JSON, not in columns."""
    buyer = buyer_from_application(db, application)

    asset = application_asset_details(application)

    # Where the dealer replies: the broker and the admins, so the completed
    # invoice reaches everyone who acts on it.
    # The column is 200 characters, so take recipients in order (broker first)
    # while they fit; the email on issue still goes to all of them.
    reply_to = ""
    for email in desk_recipients(db, application, actor_id):
        candidate = f"{reply_to}, {email}" if reply_to else email
        if len(candidate) > 200:
            break
        reply_to = candidate
    reply_to = reply_to or None

    # The form offers "Used - Good" and friends, so read the leading word.
    # Where an odometer is on file it decides instead: a reading is a fact and
    # a description is an opinion.
    described = (_text(asset.get("condition")) or "").lower()
    condition = next((c for c in ("new", "demo", "used") if described.startswith(c)), None)
    odometer = _int(asset.get("odometer"))
    condition = classify_condition(odometer) or condition

    # The cost build-up comes from the lender pricing where the deal has been
    # priced: those are the figures the lender approved, and the dealer has to
    # invoice to them. The application's own asset block is the fallback for a
    # file that has not been priced yet.
    pricing = latest_lender_pricing(db, application.id)
    money = {
        "sale_price": _decimal(asset.get("price")),
        "deposit_paid": _decimal(asset.get("deposit")),
        "trade_in_value": None,
        "payout_amount": None,
        "lender_id": None,
        "facility_type": None,
    }
    if pricing is not None:
        money = {
            "sale_price": pricing.asset_price if pricing.asset_price is not None else money["sale_price"],
            "deposit_paid": pricing.deposit_amount if pricing.deposit_amount is not None else money["deposit_paid"],
            "trade_in_value": pricing.trade_in_amount or None,
            "payout_amount": pricing.payout_amount or None,
            "lender_id": pricing.lender_id,
            "facility_type": pricing_facility(pricing),
        }

    return {
        "invoice_date": date.today(),
        "reply_to_email": reply_to,
        "supplier_gst_registered": supplier_type != SupplierType.private,
        **buyer,
        "delivery_same_as_buyer": True,
        "asset_description": _text(asset.get("description")),
        "asset_make": _text(asset.get("make")),
        "asset_model": _text(asset.get("model")),
        "asset_year": (_text(asset.get("year")) or "")[:4] or None,
        "asset_vin": _text(asset.get("vin")),
        "asset_odometer": odometer,
        "asset_condition": condition,
        **money,
    }


def ensure_request_for_approval(
    db: Session,
    application: LoanApplication,
    actor_id: Optional[str],
    tenant_id: Optional[str],
) -> Optional[TaxInvoice]:
    """Raise the dealer tax invoice request an approved asset-finance deal needs.

    An approval is the point the desk goes back to the dealer for their tax
    invoice, so the draft is waiting for the broker rather than being started
    from scratch. Only asset finance, only when the application has no invoice
    yet — an application can re-enter Approval (see change_application_status),
    and a second draft would be a second document to reconcile."""
    if application_loan_category(application) != "asset_finance":
        return None
    if db.query(TaxInvoice).filter(TaxInvoice.application_id == application.id).first():
        return None

    invoice = TaxInvoice(
        application_id=application.id,
        tenant_id=tenant_id,
        supplier_type=SupplierType.dealer,
        created_by_id=actor_id,
        **prefill_from_application(db, application, SupplierType.dealer, actor_id=actor_id),
    )
    db.add(invoice)
    db.flush()
    if actor_id:
        log_activity(
            db,
            actor_id,
            "tax_invoice_created",
            "application",
            application.id,
            {"supplier_type": SupplierType.dealer.value, "auto": "approval"},
            tenant_id=tenant_id,
        )
    return invoice


def approved_finance_amount(db: Session, application_id: str) -> Optional[Decimal]:
    """What the lender pricing this deal was approved on says is being borrowed,
    so the invoice can be checked against it."""
    pricing = latest_lender_pricing(db, application_id)
    return pricing.amount_borrowed if pricing is not None else None


def serialize(invoice: TaxInvoice, db: Optional[Session] = None) -> dict:
    data = {
        "id": invoice.id,
        "application_id": invoice.application_id,
        "supplier_type": invoice.supplier_type.value,
        "status": invoice.status.value,
        "invoice_number": invoice.invoice_number,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "attention": invoice.attention,
        "fax_number": invoice.fax_number,
        "reply_to_email": invoice.reply_to_email,
        "supplier_name": invoice.supplier_name,
        "supplier_abn": invoice.supplier_abn,
        "supplier_acn": invoice.supplier_acn,
        "supplier_abn_status": invoice.supplier_abn_status,
        "supplier_abn_name": invoice.supplier_abn_name,
        "supplier_abn_checked_at": (
            invoice.supplier_abn_checked_at.isoformat() if invoice.supplier_abn_checked_at else None
        ),
        "supplier_address": invoice.supplier_address,
        "supplier_email": invoice.supplier_email,
        "supplier_phone": invoice.supplier_phone,
        "supplier_gst_registered": invoice.supplier_gst_registered,
        "abn_withholding_declared": invoice.abn_withholding_declared,
        "buyer_name": invoice.buyer_name,
        "buyer_abn": invoice.buyer_abn,
        "buyer_acn": invoice.buyer_acn,
        "buyer_address": invoice.buyer_address,
        "delivery_same_as_buyer": invoice.delivery_same_as_buyer,
        "delivery_name": invoice.delivery_name,
        "delivery_abn": invoice.delivery_abn,
        "delivery_acn": invoice.delivery_acn,
        "delivery_address": invoice.delivery_address,
        "lender_id": invoice.lender_id,
        "lender_name": invoice.lender.name if invoice.lender else None,
        "lender_address": invoice.lender.address if invoice.lender else None,
        "facility_type": invoice.facility_type,
        "lender_owns_goods": lender_owns_goods(invoice),
        "asset_description": invoice.asset_description,
        "asset_make": invoice.asset_make,
        "asset_model": invoice.asset_model,
        "asset_year": invoice.asset_year,
        "asset_vin": invoice.asset_vin,
        "asset_registration": invoice.asset_registration,
        "asset_odometer": invoice.asset_odometer,
        "asset_condition": invoice.asset_condition,
        "asset_engine_number": invoice.asset_engine_number,
        "asset_build_date": invoice.asset_build_date,
        "asset_compliance_date": invoice.asset_compliance_date,
        "asset_colour": invoice.asset_colour,
        "asset_registration_expiry": invoice.asset_registration_expiry,
        "sale_price": float(invoice.sale_price) if invoice.sale_price is not None else None,
        "buyers_premium": float(invoice.buyers_premium) if invoice.buyers_premium is not None else None,
        "other_charges": float(invoice.other_charges) if invoice.other_charges is not None else None,
        "other_charges_label": invoice.other_charges_label,
        "deposit_paid": float(invoice.deposit_paid) if invoice.deposit_paid is not None else None,
        "trade_in_value": float(invoice.trade_in_value) if invoice.trade_in_value is not None else None,
        "payout_amount": float(invoice.payout_amount) if invoice.payout_amount is not None else None,
        "asset_payout_amount": (
            float(invoice.asset_payout_amount) if invoice.asset_payout_amount is not None else None
        ),
        "payout_account_name": invoice.payout_account_name,
        "payout_bsb": invoice.payout_bsb,
        "payout_account_number": invoice.payout_account_number,
        "payout_creditor_name": invoice.payout_creditor_name,
        "payout_creditor_bsb": invoice.payout_creditor_bsb,
        "payout_creditor_account_number": invoice.payout_creditor_account_number,
        "licence_name": invoice.licence_name,
        "registration_name": invoice.registration_name,
        "payout_letter_name": invoice.payout_letter_name,
        "valuation_needed": invoice.valuation_needed,
        "ppsr_charge": invoice.ppsr_charge,
        "ppsr_all_pap": invoice.ppsr_all_pap,
        "payout_reduced": invoice.payout_reduced,
        "valuation_market_value": (
            float(invoice.valuation_market_value) if invoice.valuation_market_value is not None else None
        ),
        "valuation_forced_sale_value": (
            float(invoice.valuation_forced_sale_value) if invoice.valuation_forced_sale_value is not None else None
        ),
        "valuer_name": invoice.valuer_name,
        "valuation_date": invoice.valuation_date.isoformat() if invoice.valuation_date else None,
        "notes": invoice.notes,
        "created_by_id": invoice.created_by_id,
        "created_by_name": invoice.created_by.full_name if invoice.created_by else None,
        "issued_at": invoice.issued_at.isoformat() if invoice.issued_at else None,
        "emailed_at": invoice.emailed_at.isoformat() if invoice.emailed_at else None,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
        "updated_at": invoice.updated_at.isoformat() if invoice.updated_at else None,
    }
    data["totals"] = totals(invoice)
    data.update(parties(invoice))
    data["dealer_to_supply"] = dealer_to_supply(invoice)
    data["seller_checklist"] = seller_checklist(invoice)
    data["expected_seller_name"] = expected_seller_name(invoice) if invoice.supplier_type == SupplierType.private else None
    data["document_title"] = document_title(invoice)
    data["missing"] = completeness(invoice)
    data["blockers"] = blockers(invoice)
    # Without a session the approved figure cannot be read, so the variance
    # alert is simply absent rather than wrongly reported as nil variance.
    data["alerts"] = alerts(
        invoice,
        approved_amount=approved_finance_amount(db, invoice.application_id) if db else None,
    )
    data["name_match"] = name_match(invoice)
    return data
