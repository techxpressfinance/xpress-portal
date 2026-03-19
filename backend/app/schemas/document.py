from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.document import DocType


class DocumentOut(BaseModel):
    id: str
    application_id: str
    doc_type: DocType
    original_filename: str
    is_verified: bool
    uploaded_at: datetime
    onedrive_url: str | None = None
    ocr_status: str = "pending"
    lend_document_type: str | None = None
    lend_uploaded: bool = False

    model_config = {"from_attributes": True}
