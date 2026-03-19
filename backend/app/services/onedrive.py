from __future__ import annotations

import base64
import logging
import re
from pathlib import Path

import httpx

from app.config import ONEDRIVE_BASE_FOLDER, ONEDRIVE_ENABLED, POWER_AUTOMATE_WEBHOOK_URL

logger = logging.getLogger(__name__)


def sanitize_filename(name: str) -> str:
    """Replace spaces with underscores, strip OneDrive-disallowed chars, collapse repeated underscores."""
    name = name.replace(" ", "_")
    name = re.sub(r'["*:<>?/\\|]', "", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_")


def upload_file_to_onedrive(
    file_path: str,
    customer_full_name: str,
    application_id: str,
    original_filename: str,
) -> tuple[str | None, str | None]:
    """Send file to Power Automate flow which uploads it to OneDrive.

    The flow receives a JSON payload with:
    - fileName: the desired filename on OneDrive
    - folderPath: the target folder path
    - fileContent: base64-encoded file bytes

    The flow should return JSON with:
    - fileId: the OneDrive item ID
    - webUrl: the shareable link to the file
    """
    safe_customer = sanitize_filename(customer_full_name)
    safe_filename = sanitize_filename(original_filename)
    app_short = application_id[:8]

    folder_path = f"{ONEDRIVE_BASE_FOLDER}/{safe_customer}_{app_short}"
    file_name = f"{safe_customer}_{safe_filename}"

    from app.services.s3_storage import download_file

    file_bytes = download_file(file_path)
    file_b64 = base64.b64encode(file_bytes).decode("ascii")

    payload = {
        "fileName": file_name,
        "folderPath": folder_path,
        "fileContent": file_b64,
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post(POWER_AUTOMATE_WEBHOOK_URL, json=payload)
        resp.raise_for_status()

    # Handle both JSON response (with fileId/webUrl) and plain-text (just file ID)
    content_type = resp.headers.get("content-type", "")
    if "application/json" in content_type:
        data = resp.json()
        return data.get("fileId"), data.get("webUrl")
    else:
        raw = resp.text.strip()
        logger.info("Power Automate returned raw response: %s", raw)
        return raw or None, None


def upload_document_background(
    document_id: str,
    file_path: str,
    customer_full_name: str,
    application_id: str,
    original_filename: str,
    session_factory,
) -> None:
    """Background task: upload to OneDrive via Power Automate, then update the Document record."""
    if not ONEDRIVE_ENABLED:
        return

    try:
        file_id, web_url = upload_file_to_onedrive(
            file_path, customer_full_name, application_id, original_filename
        )
        logger.info("Uploaded to OneDrive: %s -> %s", original_filename, web_url)
    except httpx.HTTPStatusError as exc:
        logger.error(
            "OneDrive upload returned HTTP %s for document %s: %s",
            exc.response.status_code, document_id, exc.response.text[:200],
        )
        return
    except httpx.RequestError as exc:
        logger.exception(
            "OneDrive upload network error for document %s: %s",
            document_id, type(exc).__name__,
        )
        return
    except (OSError, ValueError) as exc:
        logger.exception(
            "OneDrive upload failed for document %s (error_type=%s)",
            document_id, type(exc).__name__,
        )
        return
    except Exception:
        logger.exception("Unexpected error uploading document %s to OneDrive", document_id)
        return

    if not file_id and not web_url:
        logger.warning("Power Automate returned no file info for document %s", document_id)
        return

    try:
        from app.models.document import Document
        from app.services.db_context import background_session

        with background_session(session_factory) as db:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.onedrive_file_id = file_id
                doc.onedrive_url = web_url
    except Exception:
        logger.exception("Failed to update document %s with OneDrive info", document_id)
