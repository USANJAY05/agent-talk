#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  run_local.sh — Run AgentTalk completely locally (no Docker)
#
#  Prerequisites:
#    - Python 3.12+
#    - PostgreSQL 16 running locally  (brew install postgresql@16 / apt install postgresql)
#    - Redis 7 running locally        (brew install redis / apt install redis-server)
#
#  Usage:
#    bash scripts/run_local.sh              # start the API
#    bash scripts/run_local.sh --setup      # create DB + virtualenv first, then start
#    bash scripts/run_local.sh --stop       # kill the running server
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."          # always run from project root

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
info() { echo -e "${BLUE}  ▶${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Config (override via env) ─────────────────────────────────────────────────
VENV_DIR="${VENV_DIR:-.venv}"
PG_USER="${PG_USER:-agenttalk}"
PG_PASSWORD="${PG_PASSWORD:-agenttalk}"
PG_DB="${PG_DB:-agenttalk}"
PG_PORT="${PG_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
APP_PORT="${APP_PORT:-8000}"
PID_FILE=".server.pid"

# ── --stop flag ───────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    kill "$PID" 2>/dev/null && ok "Server (PID $PID) stopped" || warn "Process not found"
    rm -f "$PID_FILE"
  else
    warn "No PID file found — server may not be running"
  fi
  exit 0
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  AgentTalk — Local Mode (no Docker)                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Check Python ──────────────────────────────────────────────────────────────
info "Checking Python version"
PYTHON=$(command -v python3.12 || command -v python3 || fail "Python 3.12+ required")
PY_VER=$($PYTHON --version 2>&1 | awk '{print $2}')
ok "Python $PY_VER found at $PYTHON"

# ── Check PostgreSQL ──────────────────────────────────────────────────────────
info "Checking PostgreSQL"
if ! pg_isready -h localhost -p "$PG_PORT" -q 2>/dev/null; then
  fail "PostgreSQL not running on port $PG_PORT.\n\n  Start it:\n    macOS:   brew services start postgresql@16\n    Linux:   sudo systemctl start postgresql\n    Manual:  pg_ctl -D /usr/local/var/postgresql@16 start"
fi
ok "PostgreSQL is running on port $PG_PORT"

# ── Check Redis ───────────────────────────────────────────────────────────────
info "Checking Redis"
if ! redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  fail "Redis not running on port $REDIS_PORT.\n\n  Start it:\n    macOS:   brew services start redis\n    Linux:   sudo systemctl start redis\n    Manual:  redis-server --daemonize yes"
fi
ok "Redis is running on port $REDIS_PORT"

# ── --setup flag: create venv, DB, install deps ───────────────────────────────
if [[ "${1:-}" == "--setup" ]]; then
  echo ""
  info "Running first-time setup"

  # Create virtualenv
  if [[ ! -d "$VENV_DIR" ]]; then
    info "Creating virtualenv at $VENV_DIR"
    $PYTHON -m venv "$VENV_DIR"
    ok "Virtualenv created"
  else
    ok "Virtualenv already exists at $VENV_DIR"
  fi

  # Install dependencies
  info "Installing dependencies"
  "$VENV_DIR/bin/pip" install --upgrade pip -q
  "$VENV_DIR/bin/pip" install -r requirements.txt -q
  ok "Dependencies installed (includes email-validator)"

  # Create PostgreSQL user and database
  info "Setting up PostgreSQL database"
  psql -h localhost -p "$PG_PORT" -U postgres -tc \
    "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" 2>/dev/null | grep -q 1 || \
    psql -h localhost -p "$PG_PORT" -U postgres -c \
    "CREATE USER $PG_USER WITH PASSWORD '$PG_PASSWORD';" 2>/dev/null && true

  psql -h localhost -p "$PG_PORT" -U postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" 2>/dev/null | grep -q 1 || \
    psql -h localhost -p "$PG_PORT" -U postgres -c \
    "CREATE DATABASE $PG_DB OWNER $PG_USER;" 2>/dev/null && true

  ok "Database '$PG_DB' ready"
fi

# ── Verify virtualenv exists ──────────────────────────────────────────────────
if [[ ! -f "$VENV_DIR/bin/uvicorn" ]]; then
  warn "Virtualenv not set up. Run: bash scripts/run_local.sh --setup"
  fail "Missing virtualenv at $VENV_DIR"
fi

# ── Write .env if missing ─────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  info "Creating .env from template"
  cp .env.example .env
  # Patch with local values
  sed -i.bak \
    -e "s|DATABASE_URL=.*|DATABASE_URL=postgresql+asyncpg://$PG_USER:$PG_PASSWORD@localhost:$PG_PORT/$PG_DB|" \
    -e "s|REDIS_URL=.*|REDIS_URL=redis://localhost:$REDIS_PORT/0|" \
    -e "s|APP_ENV=.*|APP_ENV=development|" \
    .env && rm -f .env.bak
  ok ".env created"
else
  ok ".env already exists"
fi

# ── Export env vars ───────────────────────────────────────────────────────────
set -a
source .env
set +a

# ── Start server ──────────────────────────────────────────────────────────────
echo ""
info "Starting AgentTalk API on http://localhost:$APP_PORT"
info "Docs: http://localhost:$APP_PORT/docs"
info "Press Ctrl+C to stop"
echo ""

"$VENV_DIR/bin/uvicorn" app.main:app \
  --host 0.0.0.0 \
  --port "$APP_PORT" \
  --reload \
  --reload-dir app \
  --log-level info
