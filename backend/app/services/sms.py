from __future__ import annotations

import logging

from app.config import SMS_ENABLED, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

logger = logging.getLogger(__name__)

_STATUS_MESSAGES: dict[str, str] = {
    "application_received": "Your loan application has been received and is now under review.",
    "application_assessed": "Your application has been assessed. Your broker will be in touch with next steps.",
    "submitted": "Your application has been submitted to a lender. We'll keep you updated.",
    "approval": "Great news — your loan has been approved! Your broker will contact you shortly.",
    "settled": "Your loan has settled. Congratulations, and thank you for choosing us!",
    "rejected": "Unfortunately your application was unsuccessful. Contact your broker to discuss alternatives.",
    "not_proceeding": "Your application has been marked as not proceeding. Please contact your broker if this is incorrect.",
}


def send_status_sms(phone: str, new_status: str) -> None:
    if not SMS_ENABLED:
        return
    body = _STATUS_MESSAGES.get(new_status)
    if not body:
        return
    try:
        from twilio.rest import Client  # type: ignore[import-untyped]

        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        client.messages.create(body=body, from_=TWILIO_FROM_NUMBER, to=phone)
        logger.info("SMS sent to ...%s for status '%s'", phone[-4:], new_status)
    except Exception:
        logger.exception("Failed to send SMS to ...%s for status '%s'", phone[-4:], new_status)
