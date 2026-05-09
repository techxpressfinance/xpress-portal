from __future__ import annotations

import logging
import os
import secrets
import time
from collections import defaultdict
from threading import Lock
from typing import Optional

from fastapi import HTTPException, Request, status

_logger = logging.getLogger(__name__)

# Comma-separated list of trusted proxy IPs (e.g. "127.0.0.1,10.0.0.1")
_TRUSTED_PROXIES: set[str] = {
    ip.strip()
    for ip in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
    if ip.strip()
}

# Lua script: atomic sliding-window check-and-record.
# Returns 1 (allowed) or 0 (rejected). Atomicity prevents races across workers.
_SLIDING_WINDOW_LUA = """
local key       = KEYS[1]
local now       = tonumber(ARGV[1])
local win_start = tonumber(ARGV[2])
local max_req   = tonumber(ARGV[3])
local expire    = tonumber(ARGV[4])
local member    = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', win_start)
local count = tonumber(redis.call('ZCARD', key))

if count >= max_req then
    return 0
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, expire)
return 1
"""


def _get_redis_client():
    """Return a Redis client if REDIS_URL is configured, else None."""
    from app.config import REDIS_URL
    if not REDIS_URL:
        return None
    try:
        import redis as _redis
        client = _redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        client.ping()
        _logger.info("Rate limiter: connected to Redis at %s", REDIS_URL)
        return client
    except Exception as exc:
        _logger.warning("Rate limiter: Redis unavailable (%s) — using in-memory fallback", exc)
        return None


def _get_client_ip(request: Request) -> str:
    client_ip = request.client.host if request.client else "unknown"
    if _TRUSTED_PROXIES and client_ip in _TRUSTED_PROXIES:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return client_ip


class RateLimiter:
    """
    Sliding-window rate limiter.

    Uses Redis (ZSET + Lua) when REDIS_URL is configured — atomic and shared
    across all workers/replicas. Falls back to in-memory when Redis is absent
    (correct for single-process dev; not safe across multiple workers).
    """

    def __init__(self, max_requests: int = 5, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._redis: Optional[object] = _get_redis_client()
        self._script_sha: Optional[str] = None
        if self._redis is not None:
            self._script_sha = self._redis.script_load(_SLIDING_WINDOW_LUA)

        # In-memory fallback state
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()
        self._last_full_sweep: float = 0.0

    # ------------------------------------------------------------------
    # Redis path (sliding window via Lua)
    # ------------------------------------------------------------------

    def _check_key_redis(self, key: str) -> None:
        now = time.time()
        window_start = now - self.window_seconds
        member = f"{now}:{secrets.token_hex(4)}"
        try:
            allowed = self._redis.evalsha(
                self._script_sha, 1, key,
                now, window_start, self.max_requests,
                self.window_seconds + 1,  # expire slightly longer than window
                member,
            )
        except Exception as exc:
            _logger.error("Rate limiter Redis error: %s — allowing request", exc)
            return  # fail open rather than block all traffic on Redis outage
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Try again in {self.window_seconds} seconds.",
                headers={"Retry-After": str(self.window_seconds)},
            )

    # ------------------------------------------------------------------
    # In-memory fallback (sliding window, single-process only)
    # ------------------------------------------------------------------

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]
        if not self._requests[key]:
            del self._requests[key]

    def _sweep_stale(self, now: float) -> None:
        if now - self._last_full_sweep < self.window_seconds * 2:
            return
        self._last_full_sweep = now
        cutoff = now - self.window_seconds
        stale = [k for k, v in self._requests.items() if not v or v[-1] <= cutoff]
        for k in stale:
            del self._requests[k]

    def _check_key_memory(self, key: str) -> None:
        now = time.time()
        with self._lock:
            self._sweep_stale(now)
            self._cleanup(key, now)
            if len(self._requests[key]) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many requests. Try again in {self.window_seconds} seconds.",
                    headers={"Retry-After": str(self.window_seconds)},
                )
            self._requests[key].append(now)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _check_key(self, key: str) -> None:
        if self._redis is not None:
            self._check_key_redis(key)
        else:
            self._check_key_memory(key)

    def check(self, request: Request) -> None:
        self._check_key(_get_client_ip(request))

    def check_key(self, key: str) -> None:
        """Rate limit by an arbitrary key (e.g. email address)."""
        self._check_key(f"key:{key}")


# Pre-configured limiters
auth_limiter = RateLimiter(max_requests=10, window_seconds=60)  # 10 attempts per minute
