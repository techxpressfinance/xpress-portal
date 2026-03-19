import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status

# Comma-separated list of trusted proxy IPs (e.g. "127.0.0.1,10.0.0.1")
_TRUSTED_PROXIES: set[str] = {
    ip.strip()
    for ip in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
    if ip.strip()
}


class RateLimiter:
    """Simple in-memory rate limiter using sliding window."""

    def __init__(self, max_requests: int = 5, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _get_client_ip(self, request: Request) -> str:
        client_ip = request.client.host if request.client else "unknown"
        # Only trust X-Forwarded-For if the direct connection is from a trusted proxy
        if _TRUSTED_PROXIES and client_ip in _TRUSTED_PROXIES:
            forwarded = request.headers.get("x-forwarded-for")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return client_ip

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]

    def _check_key(self, key: str) -> None:
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            if len(self._requests[key]) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many requests. Try again in {self.window_seconds} seconds.",
                )
            self._requests[key].append(now)

    def check(self, request: Request) -> None:
        ip = self._get_client_ip(request)
        self._check_key(ip)

    def check_key(self, key: str) -> None:
        """Rate limit by an arbitrary key (e.g. email address)."""
        self._check_key(f"key:{key}")


# Pre-configured limiters
auth_limiter = RateLimiter(max_requests=10, window_seconds=60)  # 10 attempts per minute
