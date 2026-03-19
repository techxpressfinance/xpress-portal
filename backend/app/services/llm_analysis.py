import json
import logging
from datetime import datetime, timezone

from openai import APIConnectionError, APIError, OpenAI, RateLimitError

from app.config import OPENAI_API_KEY, OPENAI_MODEL
from app.models.document import Document, OcrStatus
from app.models.loan_application import AnalysisStatus, LoanApplication

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior loan underwriter AI assistant. Analyze the provided loan application documents and return a structured JSON assessment.

You MUST return valid JSON with exactly this structure:
{
  "financial_summary": {
    "income": "detected income or 'Not found'",
    "employer": "detected employer or 'Not found'",
    "bank_balance": "detected balance or 'Not found'",
    "monthly_obligations": "detected obligations or 'Not found'"
  },
  "identity_verification": {
    "name_consistent": true/false,
    "address_consistent": true/false,
    "notes": "brief explanation of consistency across documents"
  },
  "risk_assessment": {
    "risk_level": "low" | "medium" | "high",
    "debt_to_income": "estimated ratio or 'Unable to calculate'",
    "affordability": "brief affordability assessment"
  },
  "red_flags": [
    {
      "flag": "short description",
      "severity": "info" | "warning" | "critical",
      "details": "explanation"
    }
  ],
  "recommendation": {
    "decision": "approve" | "review" | "reject",
    "confidence": "low" | "medium" | "high",
    "reasoning": "2-3 sentence explanation",
    "conditions": ["any conditions for approval"]
  },
  "summary": "2-3 sentence overview of the application"
}

Be thorough but concise. If information is missing from the documents, note it as a red flag. Base your assessment solely on the provided document text."""


def gather_ocr_text(application_id: str, session_factory) -> tuple[str, dict]:
    """Query all documents for an application, validate OCR is complete, combine text."""
    from app.services.db_context import background_session

    with background_session(session_factory) as db:
        app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
        if not app:
            raise ValueError(f"Application {application_id} not found")

        docs = db.query(Document).filter(Document.application_id == application_id).all()
        if not docs:
            raise ValueError("No documents found for this application")

        not_completed = [d for d in docs if d.ocr_status != OcrStatus.completed]
        if not_completed:
            names = [d.original_filename for d in not_completed]
            raise ValueError(f"OCR not completed for: {', '.join(names)}")

        metadata = {
            "loan_type": app.loan_type.value,
            "amount": str(app.amount),
            "application_id": app.id,
        }

        sections = []
        for doc in docs:
            header = f"=== {doc.doc_type.value.replace('_', ' ').upper()} ({doc.original_filename}) ==="
            sections.append(f"{header}\n{doc.ocr_text}")

        combined = "\n\n".join(sections)
        return combined, metadata


def call_openai_analysis(combined_text: str, metadata: dict) -> str:
    """Call OpenAI with the combined document text and return the JSON response."""
    client = OpenAI(api_key=OPENAI_API_KEY)

    user_message = (
        f"Loan Application Details:\n"
        f"- Loan Type: {metadata['loan_type']}\n"
        f"- Requested Amount: ${metadata['amount']}\n\n"
        f"Extracted Document Text:\n\n{combined_text}"
    )

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    return response.choices[0].message.content


def run_analysis_background(application_id: str, session_factory) -> None:
    """Background task: run LLM analysis on all documents for an application."""
    from app.services.db_context import background_session

    # Set status to processing
    try:
        with background_session(session_factory) as db:
            app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
            if app:
                app.analysis_status = AnalysisStatus.processing
                app.analysis_error = None
    except Exception:
        logger.exception("Failed to set analysis processing status for application %s", application_id)

    # Gather OCR text
    try:
        combined_text, metadata = gather_ocr_text(application_id, session_factory)
    except ValueError as exc:
        logger.warning("Cannot analyse application %s: %s", application_id, exc)
        try:
            with background_session(session_factory) as db:
                app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
                if app:
                    app.analysis_status = AnalysisStatus.failed
                    app.analysis_error = str(exc)[:500]
        except Exception:
            logger.exception("Failed to set analysis failed status for application %s", application_id)
        return
    except Exception as exc:
        logger.exception("Failed to gather OCR text for application %s (error_type=%s)", application_id, type(exc).__name__)
        try:
            with background_session(session_factory) as db:
                app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
                if app:
                    app.analysis_status = AnalysisStatus.failed
                    app.analysis_error = str(exc)[:500]
        except Exception:
            logger.exception("Failed to set analysis failed status for application %s", application_id)
        return

    # Call OpenAI
    try:
        result_json = call_openai_analysis(combined_text, metadata)
    except RateLimitError as exc:
        logger.error(
            "OpenAI rate limit hit for application %s (model=%s): %s",
            application_id, OPENAI_MODEL, exc,
        )
        try:
            with background_session(session_factory) as db:
                app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
                if app:
                    app.analysis_status = AnalysisStatus.failed
                    app.analysis_error = f"Rate limit exceeded: {str(exc)[:480]}"
        except Exception:
            logger.exception("Failed to set analysis failed status for application %s", application_id)
        return
    except APIConnectionError as exc:
        logger.error(
            "OpenAI connection error for application %s: %s",
            application_id, exc,
        )
        try:
            with background_session(session_factory) as db:
                app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
                if app:
                    app.analysis_status = AnalysisStatus.failed
                    app.analysis_error = f"Connection error: {str(exc)[:480]}"
        except Exception:
            logger.exception("Failed to set analysis failed status for application %s", application_id)
        return
    except APIError as exc:
        logger.error(
            "OpenAI API error for application %s (model=%s, status=%s): %s",
            application_id, OPENAI_MODEL, getattr(exc, "status_code", "unknown"), exc,
        )
        try:
            with background_session(session_factory) as db:
                app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
                if app:
                    app.analysis_status = AnalysisStatus.failed
                    app.analysis_error = f"API error: {str(exc)[:490]}"
        except Exception:
            logger.exception("Failed to set analysis failed status for application %s", application_id)
        return
    except Exception as exc:
        logger.exception(
            "Unexpected error in OpenAI analysis for application %s (error_type=%s)",
            application_id, type(exc).__name__,
        )
        try:
            with background_session(session_factory) as db:
                app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
                if app:
                    app.analysis_status = AnalysisStatus.failed
                    app.analysis_error = str(exc)[:500]
        except Exception:
            logger.exception("Failed to set analysis failed status for application %s", application_id)
        return

    # Store result
    try:
        with background_session(session_factory) as db:
            app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
            if app:
                app.analysis_status = AnalysisStatus.completed
                app.analysis_result = result_json
                app.analysis_error = None
                app.analyzed_at = datetime.now(timezone.utc)
    except Exception:
        logger.exception("Failed to store analysis result for application %s", application_id)
