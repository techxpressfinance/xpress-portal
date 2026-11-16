"""Error tracking (Sentry). Inert unless SENTRY_DSN is set.

What is reported: unhandled exceptions in requests, anything logged at ERROR
(which covers failed scheduler jobs, background tasks and email sends — they log
rather than raise), and startup failures.

This portal holds borrowers' identity and financial details, so events are
scrubbed before they leave: no request bodies, cookies, headers or query
strings, no local variables from stack frames, and no user identity beyond the
internal user id.
"""
from __future__ import annotations

import logging

from app.config import APP_RELEASE, ENVIRONMENT, SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE

logger = logging.getLogger(__name__)


def _scrub(event, _hint):
    request = event.get("request")
    if request:
        for key in ("data", "cookies", "headers", "query_string", "env"):
            request.pop(key, None)
        # Magic-link and tracking tokens ride in the path.
        url = request.get("url") or ""
        for marker in ("/api/public/apply/", "/api/public/track/"):
            if marker in url:
                request["url"] = url.split(marker)[0] + marker + "[token]"
    # Log breadcrumbs carry request paths and recipient addresses.
    event.pop("breadcrumbs", None)
    user = event.get("user")
    if user:
        event["user"] = {"id": user.get("id")} if user.get("id") else {}
    return event


def _git_commit() -> str | None:
    """The deployed commit, so an error can be tied to the release that caused it."""
    import subprocess
    from pathlib import Path

    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def init_error_tracking() -> bool:
    if not SENTRY_DSN:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed — error tracking is OFF")
        return False

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=ENVIRONMENT,
        release=APP_RELEASE or _git_commit(),
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
        before_send=_scrub,
        integrations=[LoggingIntegration(level=None, event_level=logging.ERROR)],
    )
    logger.info("Error tracking enabled (environment=%s)", ENVIRONMENT)
    return True
