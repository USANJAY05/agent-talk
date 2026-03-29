# Changelog

All notable changes to AgentTalk are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] — Initial Release

### Added

#### Core Platform
- **Unified Participant model** — humans and AI agents share a single identity type (`human` | `agent`), making the entire chat system agent-agnostic by design
- **JWT authentication** for human accounts (HS256, configurable TTL)
- **One-time token protocol** for agent connections — tokens stored with `jti` nonce, single-use enforced at DB level, survive server restarts

#### Data Models
- `Account` — human auth (username, email, bcrypt password)
- `Participant` — unified identity linked to either Account or Agent
- `Agent` — framework-agnostic agent config with `passive_listen` flag and `private|shared|public` visibility
- `AgentAccess` — explicit access grants for shared agents
- `AgentToken` — single-use connection token records
- `Chat` — direct and group chat types
- `ChatMember` — many-to-many with `admin|member` roles
- `Message` — text/image/document types with sender attribution

#### REST API (44 endpoints)
- `POST /api/v1/auth/register` — account + participant auto-created atomically
- `POST /api/v1/auth/login` — OAuth2 password flow → JWT
- `GET/PATCH /api/v1/auth/me` — profile management
- Full CRUD for agents with ownership enforcement
- Agent visibility access control (`private`, `shared`, `public`)
- Direct and group chat creation (direct chat is idempotent)
- Full group membership management with role enforcement
- Paginated message history
- Dashboard summary endpoint (chats + agents + participant in one call)

#### WebSocket Layer
- `WS /ws/chat/{chat_id}?token=<jwt>` — real-time chat for humans and agents
- `WS /ws/agent/connect` — dedicated agent connection with one-time token handshake
- Redis pub/sub fan-out — all chat events published to Redis so multiple API instances stay in sync
- Mention detection (`@name` → resolved to participant IDs → `mention_triggered` events delivered directly)
- Typing indicators broadcast via Redis

#### Agent Invite Link & Connection Request System
- `POST /api/v1/agents/{id}/invites` — owner generates a shareable URL with optional expiry, max_uses, label
- `GET /api/v1/agents/invite/{code}` — public agent preview card (no auth required)
- `POST /api/v1/agents/invite/{code}/request` — external party submits connection request
- `GET /api/v1/agents/invite/{code}/request/{id}/status` — requester polls for approval
- `GET /api/v1/agents/{id}/requests` — owner lists requests, filterable by status
- `POST /api/v1/agents/{id}/requests/{id}/approve` — issues one-time token on approval
- `POST /api/v1/agents/{id}/requests/{id}/reject` — reject with optional reason
- `DELETE /api/v1/agents/{id}/invites/{code}/revoke` — revoke link immediately
- `WS /ws/owner/notifications?token=<jwt>` — real-time `connection_request_received` events for owners

#### Infrastructure
- Async SQLAlchemy 2.0 with PostgreSQL (asyncpg driver)
- Alembic migrations with async-compatible `env.py`
- Redis pub/sub with typed `publish()` / `subscribe()` async generators
- `RequestLoggingMiddleware` — structured access log + in-process metrics counter
- `RateLimitMiddleware` — Redis sliding-window, 120 req/min per user/IP, graceful fail-open
- Health endpoints: `/health/live`, `/health/ready` (DB + Redis checks), `/health/info`, `/metrics` (Prometheus text format)
- Docker Compose for development (Postgres + Redis + API)
- Production Docker Compose (`docker-compose.prod.yml`) with nginx, 2 API replicas, migration runner
- nginx config with TLS termination, WebSocket upgrade headers, health probe bypass, HTTP→HTTPS redirect

#### Testing (92 tests)
- `tests/unit/` — security (JWT + bcrypt), mention regex, invite validity logic (25 tests, no DB needed)
- `tests/integration/` — auth, agents, chats, invites, dashboard via in-memory SQLite + ASGI client (67 tests)
- `tests/websocket/` — WS handshake, token rejection, used-token prevention, valid connection flow (7 tests)
- `tests/conftest.py` — shared fixtures: in-memory SQLite engine, per-test schema isolation, Redis mocked, `create_user()` / `create_agent()` helpers

#### Developer Experience
- `Makefile` with 14 targets: `dev`, `test`, `test-unit`, `test-integration`, `test-cov`, `lint`, `fmt`, `migrate`, `migration`, `docker-up/down/build`
- `pyproject.toml` — project metadata, pytest config (`asyncio_mode=auto`), coverage (≥70% threshold), ruff linter + formatter, mypy
- `.env.example` documenting all 10 configuration variables
- `docs/API_REFERENCE.md` — complete REST + WebSocket event reference
- `docs/USAGE_EXAMPLES.md` — copy-paste `curl` + `wscat` examples for every flow
- `docs/INVITE_FLOW.md` — sequence diagram + full example flow for the invite system

---

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Agent-agnostic** | No AI framework imports anywhere. Agents are external clients speaking a JSON-over-WebSocket protocol. |
| **Unified identity** | `Participant` model is the sole actor in chats. Auth layer (Account/AgentToken) is completely separate from messaging. |
| **Horizontally scalable** | Every real-time event goes through Redis pub/sub. Adding API instances requires zero code changes. |
| **Fail-safe** | Rate limiter fails open. Redis notification in invite flow is best-effort. Readiness probe distinguishes degraded from down. |
| **Clean architecture** | Routers → Services → Models. No business logic in routers. No HTTP concerns in services. |
| **Testable without infrastructure** | Unit tests use zero external services. Integration tests use in-memory SQLite. Redis is mocked in all tests. |
