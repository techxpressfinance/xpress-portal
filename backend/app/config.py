from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

_DEFAULT_JWT_SECRET = "dev-secret-change-in-production"
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", _DEFAULT_JWT_SECRET)
_env = os.getenv("ENVIRONMENT", "production")
if JWT_SECRET_KEY == _DEFAULT_JWT_SECRET:
    if _env != "development":
        raise RuntimeError(
            "JWT_SECRET_KEY is still the default value. "
            "Set a strong, unique JWT_SECRET_KEY in your .env before running in production."
        )
    import warnings
    warnings.warn("Using default JWT_SECRET_KEY — do NOT use in production", stacklevel=1)

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")

# Email (SMTP) configuration - optional, emails silently skipped if not configured
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "tech@xpressfinance.com.au")
EMAIL_ENABLED = bool(SMTP_HOST)

# OpenAI / LLM analysis - optional, analysis feature disabled if no key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
LLM_ANALYSIS_ENABLED = bool(OPENAI_API_KEY)

# OneDrive via Power Automate - optional, uploads silently skipped if not configured
POWER_AUTOMATE_WEBHOOK_URL = os.getenv("POWER_AUTOMATE_WEBHOOK_URL", "")
if POWER_AUTOMATE_WEBHOOK_URL and not POWER_AUTOMATE_WEBHOOK_URL.startswith("https://"):
    raise RuntimeError("POWER_AUTOMATE_WEBHOOK_URL must use HTTPS")
ONEDRIVE_BASE_FOLDER = os.getenv("ONEDRIVE_BASE_FOLDER", "XpressTech")
ONEDRIVE_ENABLED = bool(POWER_AUTOMATE_WEBHOOK_URL)

# OCR engine: "easyocr" (default) or "tesseract"
OCR_ENGINE = os.getenv("OCR_ENGINE", "easyocr").lower()

# Email verification
EMAIL_VERIFICATION_EXPIRE_HOURS = int(os.getenv("EMAIL_VERIFICATION_EXPIRE_HOURS", "24"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# S3 storage - optional, falls back to local filesystem if not configured
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "")
S3_REGION = os.getenv("S3_REGION", "ap-southeast-2")
S3_ENABLED = bool(S3_BUCKET_NAME)

# CORS origins - comma-separated list
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173")

# Lend.com.au API - optional, sync disabled if no API key
LEND_API_KEY = os.getenv("LEND_API_KEY", "")
LEND_API_SECRET = os.getenv("LEND_API_SECRET", "")
LEND_ENVIRONMENT = os.getenv("LEND_ENVIRONMENT", "sandbox")
LEND_ENABLED = bool(LEND_API_KEY and LEND_API_SECRET)

# Environment
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# Field-level encryption for PII data
# Generate key: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FIELD_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "")
if ENVIRONMENT == "production" and not FIELD_ENCRYPTION_KEY:
    raise RuntimeError(
        "FIELD_ENCRYPTION_KEY is required in production for PII encryption. "
        'Generate with: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    )
