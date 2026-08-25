"""Parse dropped email files (.eml / .msg) into displayable header + body text.

Dragging a message out of the Outlook *desktop* client onto a drop zone hands
the browser a real `.msg` file; "Save as" / "Download message" from Outlook Web
and Gmail produce `.eml`. Dragging out of Gmail or Outlook in a browser hands
over only a link, so there is nothing to parse — the UI tells the user to
download the message first.

`.eml` is handled by the stdlib. `.msg` needs the optional `extract-msg`
dependency; when it isn't installed we say so rather than storing a blob the
user can't read. Outlook *for Mac* muddies this: it writes a `.msg` that is
really a MIME message, so the bytes — not the extension — pick the parser.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parsedate_to_datetime

logger = logging.getLogger(__name__)

EMAIL_EXTENSIONS = {".eml", ".msg"}
MAX_EMAIL_SIZE = 15 * 1024 * 1024
# Bodies are stored encrypted and rendered in a timeline, not used as a mail
# archive — cap them so one forwarded thread can't dominate the record.
MAX_BODY_CHARS = 20000


@dataclass
class ParsedEmail:
    subject: str | None
    sender: str | None
    recipients: str | None
    sent_at: datetime | None
    body: str | None


def _header(value: str | None) -> str | None:
    """Collapse a header to one line — long subjects wrap in the source message."""
    if not value:
        return None
    return " ".join(value.split()) or None


def _body(value: str | None) -> str | None:
    """Cap the body, keeping its line breaks so it stays readable in the timeline."""
    if not value:
        return None
    text = value.strip()
    if len(text) > MAX_BODY_CHARS:
        return text[:MAX_BODY_CHARS] + "\n\n… (truncated)"
    return text or None


def _html_to_text(html: str) -> str:
    """Crude tag strip — enough to make an HTML-only email readable inline."""
    import re
    from html import unescape

    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    return unescape(text)


def _parse_eml(contents: bytes) -> ParsedEmail:
    message = BytesParser(policy=policy.default).parsebytes(contents)

    body: str | None = None
    try:
        part = message.get_body(preferencelist=("plain", "html"))
        if part is not None:
            raw = part.get_content()
            body = raw if part.get_content_subtype() == "plain" else _html_to_text(raw)
    except Exception:  # malformed multipart — fall back to the raw payload
        logger.debug("Falling back to raw payload for dropped .eml", exc_info=True)
        payload = message.get_payload(decode=True)
        if isinstance(payload, bytes):
            body = payload.decode("utf-8", errors="replace")

    sent_at: datetime | None = None
    if message.get("Date"):
        try:
            sent_at = parsedate_to_datetime(message["Date"])
        except (TypeError, ValueError):
            sent_at = None

    recipients = ", ".join(
        str(message[header]) for header in ("To", "Cc") if message.get(header)
    )
    return ParsedEmail(
        subject=_header(str(message["Subject"])) if message.get("Subject") else None,
        sender=_header(str(message["From"])) if message.get("From") else None,
        recipients=_header(recipients),
        sent_at=sent_at,
        body=_body(body),
    )


def _looks_like_rfc822(contents: bytes) -> bool:
    """True when the bytes are a MIME message rather than an OLE2 .msg.

    Outlook for Mac (and several "save as" paths) write a `.msg` that is really
    an RFC822 message, so the extension alone can't pick the parser.
    """
    head = contents[:2048].lstrip()
    return any(
        head[: len(marker)].lower() == marker
        for marker in (b"from:", b"received:", b"return-path:", b"message-id:", b"subject:", b"date:", b"mime-version:")
    )


def _parse_msg(contents: bytes) -> ParsedEmail:
    # Outlook for Mac hands over a MIME message under a .msg name; it never opens
    # as OLE2, so sniff the bytes before reaching for extract_msg.
    if _looks_like_rfc822(contents):
        return _parse_eml(contents)

    try:
        import extract_msg
    except ImportError:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="Outlook .msg files aren't supported on this server. Save the email as .eml and drop that instead.",
        )

    import io

    try:
        return _parse_msg_ole(extract_msg, io.BytesIO(contents))
    except Exception:
        # A .msg extract_msg can't open used to escape as a 500, losing the
        # upload with no usable message. Fall back to MIME, then give up loudly.
        logger.warning("Could not parse dropped .msg as OLE2", exc_info=True)
        try:
            parsed = _parse_eml(contents)
        except Exception:
            parsed = None
        if parsed and (parsed.subject or parsed.sender):
            return parsed

        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="That .msg couldn't be read as an Outlook message. Open it in Outlook and use Save As → .eml, then drop that instead.",
        )


def _parse_msg_ole(extract_msg, stream) -> ParsedEmail:
    with extract_msg.Message(stream) as message:
        sent_at = message.date if isinstance(message.date, datetime) else None
        if sent_at is not None and sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        recipients = ", ".join(p for p in [message.to, message.cc] if p)
        body = message.body or (_html_to_text(message.htmlBody.decode("utf-8", errors="replace")) if message.htmlBody else None)
        return ParsedEmail(
            subject=_header(message.subject),
            sender=_header(message.sender),
            recipients=_header(recipients),
            sent_at=sent_at,
            body=_body(body),
        )


def parse_email(filename: str, contents: bytes) -> ParsedEmail:
    """Parse a dropped email file. `filename`'s extension selects the parser."""
    if len(contents) > MAX_EMAIL_SIZE:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Email file exceeds the 15MB limit")

    if filename.lower().endswith(".msg"):
        return _parse_msg(contents)
    return _parse_eml(contents)
