from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.encrypted_type import EncryptedString


class TrackingLink(Base):
    """A no-login link to a read-only progress page.

    Two kinds. A `referrer` link is one per referrer partner and lists every
    deal they are credited with — it lives on their profile so the desk can
    send it whenever they ring. A `deal` link is one per lead or application
    and shows the borrower their own deal.

    The token is the whole credential, so it is stored twice: encrypted, so
    staff can copy the same link again rather than minting a new one on every
    call, and as a SHA-256 hash, which is what an incoming link is looked up by
    (an encrypted column can't be matched in SQL). Revoking sets `revoked_at`;
    a regenerate revokes and mints in one step. At most one unrevoked link per
    target is kept by the service, not by a constraint — SQLite can't express
    a partial unique index portably.
    """

    __tablename__ = "tracking_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)

    token: Mapped[str] = mapped_column(EncryptedString(), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    # Exactly one target per kind: referrer_id for `referrer`; application_id or
    # lead_id for `deal`. A lead link keeps working after conversion — it is
    # resolved through Lead.converted_application_id.
    referrer_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    application_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("loan_applications.id", ondelete="CASCADE"), index=True, nullable=True
    )
    lead_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("leads.id", ondelete="CASCADE"), index=True, nullable=True
    )

    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    open_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
