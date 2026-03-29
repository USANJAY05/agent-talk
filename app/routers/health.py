"""
Health check and metrics endpoints.

/health/live   – liveness probe  (is the process up?)
/health/ready  – readiness probe (can it serve traffic? DB + Redis reachable?)
/health/info   – build/version info
/metrics       – basic request counters (Prometheus-compatible text format)
"""

import time
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import text

from app.db.session import AsyncSessionLocal
from app.db.redis import get_redis

router = APIRouter()

# ── In-memory request counter (reset on restart) ──────────────────────────────
_start_time = time.time()
_request_counts: dict[str, int] = {}


def record_request(method: str, path: str, status: int) -> None:
    """Called by middleware to track request metrics."""
    key = f"{method}:{path}:{status}"
    _request_counts[key] = _request_counts.get(key, 0) + 1


# ── Schemas ───────────────────────────────────────────────────────────────────

class LivenessResponse(BaseModel):
    status: str
    uptime_seconds: float
    timestamp: str


class ReadinessResponse(BaseModel):
    status: str          # "ready" | "degraded"
    database: str        # "ok" | "error"
    redis: str           # "ok" | "error"
    timestamp: str


class InfoResponse(BaseModel):
    service: str
    version: str
    environment: str
    started_at: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/health/live",
    response_model=LivenessResponse,
    tags=["Health"],
    summary="Liveness probe — is the process alive?",
)
async def liveness():
    """Always returns 200 while the process is running."""
    return LivenessResponse(
        status="alive",
        uptime_seconds=round(time.time() - _start_time, 2),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    tags=["Health"],
    summary="Readiness probe — can the service handle traffic?",
)
async def readiness():
    """Checks DB and Redis connectivity."""
    db_status = "ok"
    redis_status = "ok"

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    try:
        redis = get_redis()
        await redis.ping()
    except Exception:
        redis_status = "error"

    overall = "ready" if db_status == "ok" and redis_status == "ok" else "degraded"
    return ReadinessResponse(
        status=overall,
        database=db_status,
        redis=redis_status,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/health/info",
    response_model=InfoResponse,
    tags=["Health"],
    summary="Service info — version, environment",
)
async def info():
    from app.core.config import settings
    return InfoResponse(
        service="AgentTalk API",
        version="1.0.0",
        environment=settings.APP_ENV,
        started_at=datetime.fromtimestamp(_start_time, tz=timezone.utc).isoformat(),
    )


@router.get(
    "/metrics",
    tags=["Health"],
    summary="Prometheus-compatible metrics (text/plain)",
    response_class=PlainTextResponse,   # ← was None, which broke OpenAPI
)
async def metrics():
    """Basic request counters in Prometheus exposition format."""
    lines = [
        "# HELP agenttalk_requests_total Total HTTP requests by method/path/status",
        "# TYPE agenttalk_requests_total counter",
    ]
    for label, count in sorted(_request_counts.items()):
        method, path, status = label.split(":", 2)
        lines.append(
            f'agenttalk_requests_total{{method="{method}",path="{path}",status="{status}"}} {count}'
        )
    lines.append("")
    lines.append("# HELP agenttalk_uptime_seconds Process uptime in seconds")
    lines.append("# TYPE agenttalk_uptime_seconds gauge")
    lines.append(f"agenttalk_uptime_seconds {round(time.time() - _start_time, 2)}")
    return PlainTextResponse(
        "\n".join(lines) + "\n",
        media_type="text/plain; version=0.0.4",
    )
