"""Double-submit cookie CSRF protection for cookie-authenticated endpoints."""
from __future__ import annotations

import hmac
import secrets

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import ENVIRONMENT

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Safe methods: skip validation, ensure cookie exists
        if request.method in _SAFE_METHODS:
            response = await call_next(request)
            _ensure_csrf_cookie(request, response)
            return response

        # Requests with Bearer auth are inherently CSRF-safe (custom headers
        # cannot be set cross-origin without a CORS preflight that we control)
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            response = await call_next(request)
            _ensure_csrf_cookie(request, response)
            return response

        # Validate double-submit: cookie value must match header value
        csrf_cookie = request.cookies.get("csrf_token")
        csrf_header = request.headers.get("x-csrf-token")

        if not csrf_cookie or not csrf_header:
            return JSONResponse(status_code=403, content={"detail": "CSRF token missing"})

        if not hmac.compare_digest(csrf_cookie, csrf_header):
            return JSONResponse(status_code=403, content={"detail": "CSRF token mismatch"})

        response = await call_next(request)
        _ensure_csrf_cookie(request, response)
        return response


def _ensure_csrf_cookie(request: Request, response: Response) -> None:
    """Set a CSRF cookie if one doesn't already exist."""
    if "csrf_token" in request.cookies:
        return
    token = secrets.token_urlsafe(32)
    response.set_cookie(
        key="csrf_token",
        value=token,
        httponly=False,  # JS must read this
        secure=ENVIRONMENT != "development",
        samesite="lax",
        max_age=86400 * 7,
        path="/",
    )
