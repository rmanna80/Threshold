"""Rate limiting, request size limits and security headers."""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from typing import Protocol

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

log = logging.getLogger("threshold.security")

MAX_BODY_BYTES = 2 * 1024 * 1024


class Limiter(Protocol):
    def hit(self, key: str, limit: int, window_s: int) -> bool: ...


class MemoryLimiter:
    """Fixed-window limiter for single-process deployments and tests."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        window = int(time.time()) // window_s
        with self._lock:
            w, n = self._counts[key]
            if w != window:
                w, n = window, 0
            n += 1
            self._counts[key] = (w, n)
            return n <= limit


class RedisLimiter:
    """Shared fixed-window limiter (justified when running multiple API instances)."""

    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.Redis.from_url(url, socket_timeout=0.5)

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        bucket = f"rl:{key}:{int(time.time()) // window_s}"
        try:
            pipe = self._r.pipeline()
            pipe.incr(bucket)
            pipe.expire(bucket, window_s + 1)
            count, _ = pipe.execute()
            return int(count) <= limit
        except Exception:  # noqa: BLE001 - fail open on limiter outage but log it
            log.warning("rate limiter unavailable; allowing request")
            return True


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, limiter: Limiter, per_minute: int, auth_per_minute: int) -> None:
        super().__init__(app)
        self.limiter = limiter
        self.per_minute = per_minute
        self.auth_per_minute = auth_per_minute

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        length = request.headers.get("content-length")
        if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
            return JSONResponse({"detail": "Request body too large"}, status_code=413)
        client = request.client.host if request.client else "unknown"
        is_auth = request.url.path.startswith("/v1/auth")
        limit = self.auth_per_minute if is_auth else self.per_minute
        if not self.limiter.hit(f"{'auth' if is_auth else 'api'}:{client}", limit, 60):
            return JSONResponse({"detail": "Too many requests"}, status_code=429, headers={"Retry-After": "60"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response
