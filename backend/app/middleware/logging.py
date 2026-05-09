import logging
import time
import uuid

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.config import JWT_SECRET_KEY

logger = logging.getLogger("xpress.access")


def _extract_user_from_request(request: Request) -> tuple[str, str]:
    """Return (user_id, role) from JWT without a DB hit. Falls back to '-' on any error."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return "-", "-"
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        return payload.get("sub", "-"), payload.get("role", "-")
    except JWTError:
        return "-", "-"


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        start = time.time()

        response = await call_next(request)

        duration_ms = (time.time() - start) * 1000
        status_code = response.status_code

        client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
        tenant = getattr(request.state, "tenant_slug", None) or request.headers.get("x-tenant-slug", "-")
        user_id, role = _extract_user_from_request(request)
        query = f"?{request.url.query}" if request.url.query else ""
        user_agent = request.headers.get("user-agent", "-")[:80]
        content_length = response.headers.get("content-length", "-")

        msg = "%s %s%s %s %.0fms | ip=%s tenant=%s user=%s role=%s size=%s ua=%s"
        args = (
            request.method,
            request.url.path,
            query,
            status_code,
            duration_ms,
            client_ip,
            tenant,
            user_id,
            role,
            content_length,
            user_agent,
        )

        if status_code >= 500:
            logger.error(msg, *args)
        elif status_code >= 400:
            logger.warning(msg, *args)
        else:
            logger.info(msg, *args)

        response.headers["X-Request-ID"] = request_id
        return response
