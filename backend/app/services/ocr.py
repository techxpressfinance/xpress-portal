import logging
import os

import fitz
from PIL import Image

from app.config import OCR_ENGINE
from app.models.document import OcrStatus

logger = logging.getLogger(__name__)

# Lazy-loaded OCR readers
_easyocr_reader = None

# Minimum character count to consider embedded text usable
_MIN_TEXT_LENGTH = 20


def _get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr

        logger.info("Loading EasyOCR model (first use)...")
        _easyocr_reader = easyocr.Reader(["en"], gpu=False)
        logger.info("EasyOCR model loaded")
    return _easyocr_reader


def _ocr_image_easyocr(img: Image.Image) -> str:
    """Run EasyOCR on a PIL Image."""
    import numpy as np

    reader = _get_easyocr_reader()
    img_array = np.array(img)
    results = reader.readtext(img_array, detail=0, paragraph=True)
    return "\n".join(results).strip()


def _ocr_image_tesseract(img: Image.Image) -> str:
    """Run Tesseract on a PIL Image."""
    import pytesseract

    return pytesseract.image_to_string(img).strip()


def _ocr_image(img: Image.Image) -> str:
    """Run OCR on a PIL Image using the configured engine."""
    if OCR_ENGINE == "tesseract":
        return _ocr_image_tesseract(img)
    return _ocr_image_easyocr(img)


def extract_text_from_file(file_path: str) -> str:
    """Extract text from an image or PDF file.

    Uses PyMuPDF embedded text extraction first (free, instant).
    Falls back to the configured OCR engine for scanned/image-based content.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in (".jpg", ".jpeg", ".png"):
        img = Image.open(file_path)
        return _ocr_image(img)

    if ext == ".pdf":
        doc = fitz.open(file_path)
        pages = []
        for i, page in enumerate(doc):
            # Try embedded text first (digitally-created PDFs)
            text = page.get_text().strip()
            if len(text) >= _MIN_TEXT_LENGTH:
                pages.append(f"--- Page {i + 1} ---\n{text}")
            else:
                # Scanned page — render to image and OCR
                mat = fitz.Matrix(300 / 72, 300 / 72)  # 300 DPI
                pix = page.get_pixmap(matrix=mat)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                ocr_text = _ocr_image(img)
                pages.append(f"--- Page {i + 1} ---\n{ocr_text}")
        doc.close()
        return "\n\n".join(pages)

    raise ValueError(f"Unsupported file type: {ext}")


def run_ocr_background(document_id: str, file_path: str, session_factory) -> None:
    """Background task: run OCR on a document and store the result."""
    from app.models.document import Document
    from app.services.db_context import background_session
    from app.services.s3_storage import get_local_path

    # Set status to processing
    try:
        with background_session(session_factory) as db:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.ocr_status = OcrStatus.processing
    except Exception:
        logger.exception("Failed to set OCR processing status for document %s", document_id)

    # Get a local path (downloads from S3 if needed)
    local_path = get_local_path(file_path)
    try:
        text = extract_text_from_file(local_path)
    except (ValueError, OSError, RuntimeError) as exc:
        logger.exception(
            "OCR extraction failed for document %s (engine=%s, error_type=%s)",
            document_id, OCR_ENGINE, type(exc).__name__,
        )
        try:
            with background_session(session_factory) as db:
                doc = db.query(Document).filter(Document.id == document_id).first()
                if doc:
                    doc.ocr_status = OcrStatus.failed
                    doc.ocr_error = str(exc)[:500]
        except Exception:
            logger.exception("Failed to set OCR failed status for document %s", document_id)
        return
    except Exception as exc:
        logger.exception(
            "Unexpected error during OCR for document %s (engine=%s, error_type=%s)",
            document_id, OCR_ENGINE, type(exc).__name__,
        )
        try:
            with background_session(session_factory) as db:
                doc = db.query(Document).filter(Document.id == document_id).first()
                if doc:
                    doc.ocr_status = OcrStatus.failed
                    doc.ocr_error = str(exc)[:500]
        except Exception:
            logger.exception("Failed to set OCR failed status for document %s", document_id)
        return

    finally:
        # Clean up temp file if we downloaded from S3
        if local_path != file_path and os.path.exists(local_path):
            os.remove(local_path)

    # Store result
    try:
        with background_session(session_factory) as db:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.ocr_status = OcrStatus.completed
                doc.ocr_text = text[:500_000]  # Cap stored OCR text at 500KB
    except Exception:
        logger.exception("Failed to store OCR result for document %s", document_id)
