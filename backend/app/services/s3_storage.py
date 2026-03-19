"""Storage abstraction: S3 when configured, local filesystem otherwise."""
from __future__ import annotations

import logging
import os
import tempfile

from app.config import S3_BUCKET_NAME, S3_ENABLED, S3_REGION, UPLOAD_DIR

logger = logging.getLogger(__name__)

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        import boto3

        _s3_client = boto3.client("s3", region_name=S3_REGION)
    return _s3_client


def upload_file(contents: bytes, stored_name: str) -> str:
    """Upload file bytes and return the storage key/path.

    Returns an S3 key (e.g. "uploads/abc.pdf") or a local file path.
    """
    if S3_ENABLED:
        key = f"uploads/{stored_name}"
        _get_s3_client().put_object(
            Bucket=S3_BUCKET_NAME,
            Key=key,
            Body=contents,
        )
        logger.info("Uploaded %s to S3 bucket %s", key, S3_BUCKET_NAME)
        return key

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(UPLOAD_DIR, stored_name)
    with open(file_path, "wb") as f:
        f.write(contents)
    return file_path


def download_file(storage_path: str) -> bytes:
    """Download file bytes from storage."""
    if S3_ENABLED and storage_path.startswith("uploads/"):
        resp = _get_s3_client().get_object(Bucket=S3_BUCKET_NAME, Key=storage_path)
        return resp["Body"].read()

    with open(storage_path, "rb") as f:
        return f.read()


def get_local_path(storage_path: str) -> str:
    """Return a local file path, downloading from S3 to a temp file if needed.

    Caller is responsible for cleanup of temp files.
    """
    if S3_ENABLED and storage_path.startswith("uploads/"):
        file_bytes = download_file(storage_path)
        ext = os.path.splitext(storage_path)[1]
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        tmp.write(file_bytes)
        tmp.close()
        return tmp.name

    return storage_path


def delete_file(storage_path: str) -> None:
    """Delete a file from storage."""
    if S3_ENABLED and storage_path.startswith("uploads/"):
        _get_s3_client().delete_object(Bucket=S3_BUCKET_NAME, Key=storage_path)
        logger.info("Deleted %s from S3", storage_path)
        return

    if os.path.exists(storage_path):
        os.remove(storage_path)


def file_exists(storage_path: str) -> bool:
    """Check if a file exists in storage."""
    if S3_ENABLED and storage_path.startswith("uploads/"):
        try:
            _get_s3_client().head_object(Bucket=S3_BUCKET_NAME, Key=storage_path)
            return True
        except Exception:
            return False

    return os.path.exists(storage_path)
