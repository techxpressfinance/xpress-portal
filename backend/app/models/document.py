from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DocType(str, enum.Enum):
    id_proof = "id_proof"
    address_proof = "address_proof"
    bank_statement = "bank_statement"
    payslip = "payslip"
    tax_return = "tax_return"
    other = "other"


class OcrStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id: Mapped[str] = mapped_column(String(36), ForeignKey("loan_applications.id"), nullable=False, index=True)
    doc_type: Mapped[DocType] = mapped_column(Enum(DocType), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    onedrive_file_id: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    onedrive_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    ocr_status: Mapped[OcrStatus] = mapped_column(Enum(OcrStatus), default=OcrStatus.pending, nullable=False)
    ocr_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ocr_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    lend_document_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    lend_uploaded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    application = relationship("LoanApplication", back_populates="documents")
