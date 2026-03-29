"""
AgentTalk - Real-time Messaging Platform
Entry point for the FastAPI application.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.logging import setup_logging
from app.core.middleware import RateLimitMiddleware, RequestLoggingMiddleware
from app.db.session import init_db
from app.routers import (
    auth, participants, agents, chats, messages,
    groups, dashboard, invites, health, files, webhooks,
)
from app.websocket import chat_ws, agent_ws, owner_ws


setup_logging()

# Frontend dist directory (built by `npm run build` inside frontend/)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle."""
    await init_db()
    yield


app = FastAPI(
    title="AgentTalk API",
    description=(
        "A production-grade real-time messaging platform that treats both humans "
        "and AI agents as first-class participants. Agent-agnostic by design.\n\n"
        "## Quick links\n"
        "- [Invite Flow docs](/docs#tag/Agent-Invites--Requests)\n"
        "- [WebSocket protocol](/docs#tag/WebSocket---Chat)\n"
        "- [Health checks](/health/live)\n"
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.APP_ENV != "test":
    app.add_middleware(
        RateLimitMiddleware,
        requests_per_window=settings.RATE_LIMIT_REQUESTS,
        window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
    )

app.add_middleware(RequestLoggingMiddleware)

# ── REST Routers ──────────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router,         prefix="/api/v1/auth",         tags=["Authentication"])
app.include_router(participants.router, prefix="/api/v1/participants",  tags=["Participants"])
app.include_router(agents.router,       prefix="/api/v1/agents",        tags=["Bots"])
app.include_router(invites.router,      prefix="/api/v1/agents",        tags=["Bot Invites & Requests"])
app.include_router(chats.router,        prefix="/api/v1/chats",         tags=["Chats"])
app.include_router(messages.router,     prefix="/api/v1/messages",      tags=["Messages"])
app.include_router(groups.router,       prefix="/api/v1/groups",        tags=["Groups"])
app.include_router(dashboard.router,    prefix="/api/v1/dashboard",     tags=["Dashboard"])
app.include_router(files.router,        prefix="/api/v1/files",         tags=["Files"])
app.include_router(webhooks.router,     prefix="/api/v1/webhooks",      tags=["Webhooks"])

# ── WebSocket Routers ─────────────────────────────────────────────────────────
app.include_router(chat_ws.router,  tags=["WebSocket - Chat"])
app.include_router(agent_ws.router, tags=["WebSocket - Bot"])
app.include_router(owner_ws.router, tags=["WebSocket - Owner Notifications"])

# ── API info root ─────────────────────────────────────────────────────────────
@app.get("/api", tags=["Health"], include_in_schema=False)
async def api_root():
    return {"status": "ok", "service": "AgentTalk API", "version": "1.0.0"}

# ── Serve built frontend (production mode) ─────────────────────────────────────
# Only active when `frontend/dist/` exists (after `npm run build`).
# In development the Vite dev server handles the frontend on port 5173.
_RESERVED_PREFIXES = (
    "/api/", "/ws/", "/health", "/metrics", "/docs", "/redoc",
    "/openapi.json", "/assets/",
)

# ── Serve uploads (development/local mode) ───────────────────────────────────
_uploads_dir = Path(__file__).parent.parent / "uploads"
_uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

if FRONTEND_DIST.exists():
    # Serve JS/CSS/image assets from dist/assets/
    _assets_dir = FRONTEND_DIST / "assets"
    if _assets_dir.exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(_assets_dir)),
            name="fe-assets",
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(request: Request, full_path: str):
        """
        SPA catch-all: serve index.html for any path not claimed by the API.
        Lets React Router handle client-side navigation.
        """
        # Let reserved prefixes fall through to their own handlers
        if any(request.url.path.startswith(p) for p in _RESERVED_PREFIXES):
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return JSONResponse(
            {"status": "ok", "note": "Frontend not built. Run: cd frontend && npm run build"},
            status_code=200,
        )
else:
    # Dev mode: just return a helpful JSON at /
    @app.get("/", tags=["Health"], include_in_schema=False)
    async def root():
        return {
            "status": "ok",
            "service": "AgentTalk API",
            "version": "1.0.0",
            "frontend": "http://localhost:5173",
            "docs": "/docs",
            "health": "/health/ready",
        }
