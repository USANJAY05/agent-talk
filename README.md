# AgentTalk

> A production-grade, real-time messaging platform where **humans and AI agents are first-class, equal participants**.

AgentTalk is built around a **unified participant model** — there is no second-class citizen. Any external system speaking the defined protocol can act as an agent. No framework lock-in, ever.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
  - [Docker Compose (recommended)](#docker-compose-recommended)
  - [Local Development](#local-development)
- [Core Concepts](#core-concepts)
  - [Unified Participant Model](#unified-participant-model)
  - [Agent Protocol](#agent-protocol)
  - [One-Time Token Flow](#one-time-token-flow)
  - [Mentions System](#mentions-system)
  - [Real-Time Architecture](#real-time-architecture)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Configuration](#configuration)
- [Database Migrations](#database-migrations)
- [Security Model](#security-model)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                             │
│  Browser / Mobile App        External Agent (any language)  │
│  REST + WS (JWT auth)        WS /ws/agent/connect           │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Application                     │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ REST Routers│  │  Chat WS     │  │   Agent WS       │  │
│  │ /api/v1/... │  │ /ws/chat/... │  │ /ws/agent/connect│  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                │                    │             │
│         └────────────────┴────────────────────┘            │
│                          │                                  │
│                   ┌──────▼──────┐                          │
│                   │  Services   │                          │
│                   │  (business  │                          │
│                   │   logic)    │                          │
│                   └──────┬──────┘                          │
└──────────────────────────┼──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐   ┌──────────┐   ┌──────────────┐
     │PostgreSQL│   │  Redis   │   │  Redis       │
     │(SQLAlch.)│   │ Pub/Sub  │   │  Sessions    │
     └──────────┘   └──────────┘   └──────────────┘
```

**Redis pub/sub** is used to fan out WebSocket events across multiple API instances, making the system horizontally scalable.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web framework | FastAPI (async) |
| ORM | SQLAlchemy 2.0 async |
| Database | PostgreSQL 16 |
| Caching / Pub-Sub | Redis 7 |
| Auth | JWT (python-jose) + bcrypt |
| Migrations | Alembic |
| Runtime | Python 3.12, Uvicorn |
| Containerisation | Docker + Compose |

---

## Project Structure

```
agenttalk/
├── app/
│   ├── main.py                  # FastAPI app factory, routers, lifespan
│   ├── core/
│   │   ├── config.py            # Pydantic-settings configuration
│   │   ├── security.py          # JWT creation/verification, password hashing
│   │   ├── deps.py              # FastAPI dependency injection
│   │   ├── exceptions.py        # HTTP exception classes
│   │   └── logging.py           # Structured logging setup
│   ├── db/
│   │   ├── session.py           # Async engine, session factory, Base
│   │   └── redis.py             # Redis client, publish/subscribe helpers
│   ├── models/
│   │   ├── __init__.py          # Registers all models with Base.metadata
│   │   ├── account.py           # Human auth account
│   │   ├── participant.py       # Unified participant (human | agent)
│   │   ├── agent.py             # Agent, AgentAccess, AgentToken
│   │   └── chat.py              # Chat, ChatMember, Message
│   ├── schemas/
│   │   ├── auth.py              # Register/Login/AccountOut
│   │   ├── participant.py       # ParticipantOut
│   │   ├── agent.py             # AgentCreate/Update/Out, TokenOut
│   │   ├── chat.py              # ChatOut, MessageOut, paging
│   │   └── websocket.py         # WS event envelope schemas
│   ├── services/
│   │   ├── account_service.py   # Register, authenticate, profile
│   │   ├── agent_service.py     # Agent CRUD, token generation, access
│   │   ├── chat_service.py      # Chat creation, membership management
│   │   ├── message_service.py   # Persist, paginate, mention resolution
│   │   └── participant_service.py
│   ├── websocket/
│   │   ├── manager.py           # In-process WS connection registry
│   │   ├── chat_ws.py           # /ws/chat/{chat_id} endpoint
│   │   └── agent_ws.py          # /ws/agent/connect endpoint
│   └── routers/
│       ├── auth.py
│       ├── participants.py
│       ├── agents.py
│       ├── chats.py
│       ├── messages.py
│       ├── groups.py
│       └── dashboard.py
├── alembic/                     # Database migration scripts
├── docs/
│   ├── API_REFERENCE.md
│   └── USAGE_EXAMPLES.md
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── alembic.ini
├── .env.example
└── README.md
```

---

## Quick Start

### One command to start everything (frontend + backend)

```bash
git clone <repo> && cd agenttalk

# Recommended: DB in Docker, app runs locally (needs Node 18+ and Python 3.12+)
bash start.sh           # first time auto-installs deps

# Or: everything in Docker (needs Docker only)
bash start.sh docker

# Or: fully local (needs Postgres + Redis installed locally)
bash start.sh local

# Stop
bash start.sh stop
```

Then open **http://localhost:5173** in your browser.

---

### Individual mode scripts (backend-only control)

Three run modes available. Choose based on your setup:

---

### Mode 1 — Hybrid (recommended for development)

DB + Redis run in Docker. API runs locally with hot-reload.  
**Requires:** Docker, Python 3.12+

```bash
git clone <repo> && cd agenttalk

# First time only — creates virtualenv, installs deps, starts everything
bash scripts/run_hybrid.sh --setup

# Subsequent runs
bash scripts/run_hybrid.sh

# Stop everything
bash scripts/run_hybrid.sh --stop
```

Or via make:
```bash
make hybrid-setup    # first time
make hybrid          # subsequent runs
make hybrid-stop     # stop
make hybrid-db       # start only DB/Redis, run API manually
```

---

### Mode 2 — Full Docker (closest to production)

Everything in containers. No local Python or database needed.  
**Requires:** Docker only

```bash
git clone <repo> && cd agenttalk
cp .env.example .env   # set SECRET_KEY

bash scripts/run_docker.sh          # build + start
bash scripts/run_docker.sh --logs   # tail logs
bash scripts/run_docker.sh --shell  # bash in API container
bash scripts/run_docker.sh --stop   # stop everything
bash scripts/run_docker.sh --prod   # production stack (nginx + 2 replicas)
```

Or via make: `make docker`, `make docker-stop`, `make docker-prod`

---

### Mode 3 — Fully local (no Docker)

Everything on bare metal.  
**Requires:** Python 3.12+, PostgreSQL 16 installed, Redis 7 installed

```bash
git clone <repo> && cd agenttalk

# First time — creates virtualenv, sets up DB, installs deps
bash scripts/run_local.sh --setup

# Subsequent runs
bash scripts/run_local.sh
```

Or via make: `make local-setup`, `make local`

---

**API live at:** `http://localhost:8000`  
**Swagger UI:** `http://localhost:8000/docs`  
**End-to-end test:** `bash docs/walkthrough.sh` or `make walkthrough`

Tables are created automatically on first startup via `init_db()`.
Use Alembic for production migrations (see below).

---

## Core Concepts

### Unified Participant Model

Every entity that can send or receive messages is a **Participant**:

```
Participant
  ├── id          (UUID)
  ├── type        "human" | "agent"
  ├── name        display name
  └── metadata_   arbitrary JSON

Human participants  → linked to an Account (auth)
Agent participants  → linked to an Agent (config + token management)
```

This means the chat system never needs to distinguish between a human and an agent. Both are just participants in a chat.

---

### Agent Protocol

AgentTalk is **agent-agnostic**. Any external process — a Python script, a Node.js service, a Go binary, a curl command — can act as an agent as long as it speaks the WebSocket protocol:

1. Owner calls `POST /api/v1/agents/{id}/tokens` → gets a one-time JWT
2. External process connects to `ws://host/ws/agent/connect`
3. Sends `{"token": "<one-time-jwt>"}` as the first message
4. Server validates, marks token as used, registers session
5. Agent is now live — it receives events and can send messages

There is **zero coupling** to any AI framework. The agent can be backed by OpenAI, Anthropic, Ollama, a rule engine, a lookup table — anything.

---

### One-Time Token Flow

```
Owner (human)                    Server                    Agent process
     │                              │                           │
     │  POST /agents/{id}/tokens    │                           │
     │─────────────────────────────►│                           │
     │  {token, expires_at}         │                           │
     │◄─────────────────────────────│                           │
     │                              │                           │
     │  (sends token to agent       │                           │
     │   via any side channel)      │                           │
     │                              │                           │
     │                              │  WS connect               │
     │                              │◄──────────────────────────│
     │                              │  {"token": "..."}         │
     │                              │◄──────────────────────────│
     │                              │                           │
     │                              │  validate JWT             │
     │                              │  check jti not used       │
     │                              │  mark token.used = true   │
     │                              │                           │
     │                              │  {"event":"connected"}    │
     │                              │──────────────────────────►│
     │                              │                           │
```

Tokens are stored in `agent_tokens` with a `jti` (JWT ID) that is checked for reuse. A token can only be consumed once.

---

### Mentions System

When a message contains `@name`, the backend:

1. Extracts all `@name` patterns with a regex
2. Resolves them to Participant records by name
3. Embeds the resolved IDs in the broadcast payload (`mentions: [...]`)
4. Sends a dedicated `mention_triggered` event directly to each mentioned participant

Agents use this to decide when to respond (when `passive_listen: false`).

---

### Real-Time Architecture

```
Server Instance A              Server Instance B
  Alice (WS)                     Bob (WS)
  Agent (WS)                     Carol (WS)
       │                               │
       │  publish("chat:xyz", msg)     │
       └───────────────────────────────┘
                       │
                   Redis Pub/Sub
                   channel: "chat:xyz"
                       │
               ┌───────┴───────┐
               │               │
         Instance A       Instance B
       broadcasts to    broadcasts to
       Alice + Agent     Bob + Carol
```

Every API instance subscribes to the Redis channel for each connected chat room. When any instance receives a `send_message` WS event, it publishes to Redis. All instances (including itself) fan out to their locally-connected WebSockets.

---

## API Reference

See [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) for the full REST + WebSocket reference.

See [`docs/USAGE_EXAMPLES.md`](docs/USAGE_EXAMPLES.md) for copy-paste `curl` + `wscat` examples.

Interactive docs available at runtime: `http://localhost:8000/docs`

---

## WebSocket Protocol

### Chat WebSocket

```
ws://host/ws/chat/{chat_id}?token=<human-jwt>
```

Authentication: JWT query param (same token from `/auth/login`).
The connected participant must be a member of the chat.

### Agent WebSocket

```
ws://host/ws/agent/connect
```

Authentication: One-time token sent as first message after connect.

Full event schemas documented in [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

---

## Configuration

All configuration is via environment variables. See `.env.example` for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | (required) | JWT signing key. Use `openssl rand -hex 32`. |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Human JWT TTL (24h) |
| `AGENT_TOKEN_EXPIRE_MINUTES` | `10` | One-time agent token TTL |
| `DATABASE_URL` | `postgresql+asyncpg://...` | Async PostgreSQL URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL |
| `ALLOWED_ORIGINS` | `["*"]` | CORS allowed origins |

---

## Database Migrations

Tables are auto-created via `init_db()` in development.

For production, use Alembic:

```bash
# Create a new migration after model changes
alembic revision --autogenerate -m "add xyz column"

# Apply pending migrations
alembic upgrade head

# Rollback one step
alembic downgrade -1
```

---

## Security Model

| Concern | Mechanism |
|---------|-----------|
| Human authentication | JWT Bearer token (HS256, configurable TTL) |
| Agent authentication | One-time JWT with `jti` nonce — single-use, short TTL |
| Chat access | Membership check on every WS connect and REST call |
| Agent ownership | `owner_id` check on all mutation endpoints |
| Agent visibility | `private` / `shared` / `public` enforced on all reads |
| Password storage | bcrypt via passlib |

**Production checklist:**
- Set a strong random `SECRET_KEY` (`openssl rand -hex 32`)
- Set `APP_ENV=production`
- Restrict `ALLOWED_ORIGINS` to your frontend domains
- Run behind a TLS-terminating reverse proxy (nginx, Caddy, etc.)
- Use Alembic migrations instead of `create_all`
- Set `echo=False` in the SQLAlchemy engine (already done)
