"""
Custom ASGI middleware for AgentTalk.

1. RequestLoggingMiddleware  — structured access log per request
2. RateLimitMiddleware       — sliding-window rate limiter backed by Redis
                               Falls back gracefully if Redis is unavailable.
"""

import time
import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger(__name__)


# ── 1. Request Logging ────────────────────────────────────────────────────────

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Logs every HTTP request with method, path, status code and duration.
    Also feeds the in-process metrics counter.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)

        # Skip noisy health probes from access logs in production
        if request.url.path not in ("/health/live", "/health/ready"):
            logger.info(
                "%s %s %s %.2fms",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )

        # Feed metrics counter
        try:
            from app.routers.health import record_request
            record_request(request.method, request.url.path, response.status_code)
        except Exception:
            pass  # never break a request for metrics

        return response


# ── 2. Rate Limiting ──────────────────────────────────────────────────────────

class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Sliding-window rate limiter using Redis sorted sets.

    Config (set on the instance):
      requests_per_window  – max requests allowed (default: 120)
      window_seconds       – window size in seconds (default: 60)

    The client is identified by:
      - The `sub` claim of the JWT (if present and decodable)
      - Falls back to the client IP address

    WebSocket upgrade requests and health endpoints are excluded.

    If Redis is unreachable the middleware lets the request through
    (fail-open) to avoid a Redis outage taking down the API.
    """

    def __init__(
        self,
        app: ASGIApp,
        requests_per_window: int = 120,
        window_seconds: int = 60,
    ):
        super().__init__(app)
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Exclude health probes and WS upgrades from rate limiting
        if (
            request.url.path.startswith("/health")
            or request.url.path == "/metrics"
            or request.headers.get("upgrade", "").lower() == "websocket"
        ):
            return await call_next(request)

        client_key = await self._identify_client(request)

        try:
            allowed = await self._check_rate_limit(client_key)
        except Exception as exc:
            logger.warning("Rate limit check failed (fail-open): %s", exc)
            allowed = True

        if not allowed:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please slow down.",
                    "retry_after": self.window_seconds,
                },
                headers={"Retry-After": str(self.window_seconds)},
            )

        return await call_next(request)

    async def _identify_client(self, request: Request) -> str:
        """Return a string key representing this client."""
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            try:
                from app.core.security import decode_token
                payload = decode_token(auth[7:])
                return f"user:{payload['sub']}"
            except Exception:
                pass
        # Fall back to IP
        forwarded = request.headers.get("X-Forwarded-For")
        ip = forwarded.split(",")[0].strip() if forwarded else (
            request.client.host if request.client else "unknown"
        )
        return f"ip:{ip}"

    async def _check_rate_limit(self, client_key: str) -> bool:
        """
        Sliding-window check using a Redis sorted set.
        Returns True if the request is allowed, False if rate-limited.
        """
        from app.db.redis import get_redis
        redis = get_redis()
        now = time.time()
        window_start = now - self.window_seconds
        redis_key = f"ratelimit:{client_key}"

        pipe = redis.pipeline()
        # Remove timestamps outside the current window
        pipe.zremrangebyscore(redis_key, "-inf", window_start)
        # Count requests in the current window
        pipe.zcard(redis_key)
        # Add this request's timestamp
        pipe.zadd(redis_key, {str(now): now})
        # Set expiry on the key to avoid stale data
        pipe.expire(redis_key, self.window_seconds * 2)
        results = await pipe.execute()

        current_count = results[1]
        return current_count < self.requests_per_window
