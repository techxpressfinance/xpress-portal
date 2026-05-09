from __future__ import annotations

from app.models.quote_sheet import QuoteOption, QuoteSheet


def serialize_quote_option(opt: QuoteOption) -> dict:
    return {
        "id": opt.id,
        "quote_sheet_id": opt.quote_sheet_id,
        "sort_order": opt.sort_order,
        "is_recommended": opt.is_recommended,
        "lender_name": opt.lender_name,
        "lender_product": opt.lender_product,
        "purchase_price": float(opt.purchase_price) if opt.purchase_price is not None else None,
        "deposit": float(opt.deposit) if opt.deposit is not None else None,
        "loan_amount": float(opt.loan_amount) if opt.loan_amount is not None else None,
        "loan_term_months": opt.loan_term_months,
        "balloon_residual": float(opt.balloon_residual) if opt.balloon_residual is not None else None,
        "interest_rate": float(opt.interest_rate) if opt.interest_rate is not None else None,
        "comparison_rate": float(opt.comparison_rate) if opt.comparison_rate is not None else None,
        "establishment_fee": float(opt.establishment_fee) if opt.establishment_fee is not None else None,
        "monthly_account_fee": float(opt.monthly_account_fee) if opt.monthly_account_fee is not None else None,
        "application_fee": float(opt.application_fee) if opt.application_fee is not None else None,
        "brokerage": float(opt.brokerage) if opt.brokerage is not None else None,
        "repayment_monthly": float(opt.repayment_monthly) if opt.repayment_monthly is not None else None,
        "repayment_fortnightly": float(opt.repayment_fortnightly) if opt.repayment_fortnightly is not None else None,
        "repayment_weekly": float(opt.repayment_weekly) if opt.repayment_weekly is not None else None,
        "total_repayments": float(opt.total_repayments) if opt.total_repayments is not None else None,
        "total_interest": float(opt.total_interest) if opt.total_interest is not None else None,
        "total_fees": float(opt.total_fees) if opt.total_fees is not None else None,
        "features": opt.features,
        "notes": opt.notes,
        "created_at": opt.created_at.isoformat(),
    }


def serialize_quote_sheet(sheet: QuoteSheet) -> dict:
    return {
        "id": sheet.id,
        "application_id": sheet.application_id,
        "version": sheet.version,
        "title": sheet.title,
        "status": sheet.status.value,
        "created_by_id": sheet.created_by_id,
        "created_by_name": sheet.created_by.full_name if sheet.created_by else None,
        "broker_notes": sheet.broker_notes,
        "input_parameters": sheet.input_parameters,
        "recipient_name": sheet.recipient_name,
        "recipient_email": sheet.recipient_email,
        "sent_at": sheet.sent_at.isoformat() if sheet.sent_at else None,
        "options": [serialize_quote_option(o) for o in sheet.options],
        "created_at": sheet.created_at.isoformat(),
        "updated_at": sheet.updated_at.isoformat(),
    }
