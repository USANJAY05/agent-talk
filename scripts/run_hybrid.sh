#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  run_hybrid.sh — Hybrid mode: PostgreSQL + Redis in Docker, API runs locally
#
#  Best for development:
#    - No need to install/configure Postgres or Redis locally
#    - App code runs outside Docker so hot-reload and debuggers work normally
#    - File edits are reflected instantly without rebuilding any container
#
#  Prerequisites:
#    - Docker Desktop or Docker Engine running
#    - Python 3.12+ with virtualenv set up (run with --setup on first use)
#
#  Usage:
#    bash scripts/run_hybrid.sh             # start DB/Redis containers + local API
#    bash scripts/run_hybrid.sh --setup     # install deps + start everything
#    bash scripts/run_hybrid.sh --stop      # stop API + remove containers
#    bash scripts/run_hybrid.sh --db-only   # start just DB and Redis (no API)
#    bash scripts/run_hybrid.sh --logs      # tail container logs
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
info() { echo -e "${BLUE}  ▶${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
VENV_DIR="${VENV_DIR:-.venv}"
APP_PORT="${APP_PORT:-8000}"
PG_PORT="${PG_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
PG_USER="agenttalk"
PG_PASSWORD="agenttalk"
PG_DB="agenttalk"
COMPOSE_PROJECT="agenttalk_hybrid"
PID_FILE=".server.pid"

# ── Docker check ──────────────────────────────────────────────────────────────
check_docker() {
  if ! docker info &>/dev/null; then
    fail "Docker is not running. Start Docker Desktop or Docker Engine first."
  fi
}

# ── --stop ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
  info "Stopping API server"
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    kill "$PID" 2>/dev/null && ok "Server (PID $PID) stopped" || warn "Process not found"
    rm -f "$PID_FILE"
  else
    warn "No PID file found"
  fi
  info "Stopping Docker containers"
  docker compose -p "$COMPOSE_PROJECT" \
    -f - down <<COMPOSE
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
  redis:
    image: redis:7-alpine
COMPOSE
  ok "Containers stopped"
  exit 0
fi

# ── --logs ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--logs" ]]; then
  docker compose -p "$COMPOSE_PROJECT" logs -f
  exit 0
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  AgentTalk — Hybrid Mode (DB in Docker, App local)       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

check_docker

# ── --setup: install Python deps ─────────────────────────────────────────────
if [[ "${1:-}" == "--setup" ]] || [[ ! -f "$VENV_DIR/bin/uvicorn" ]]; then
  info "Setting up Python environment"
  PYTHON=$(command -v python3.12 || command -v python3 || fail "Python 3.12+ required")
  if [[ ! -d "$VENV_DIR" ]]; then
    $PYTHON -m venv "$VENV_DIR"
    ok "Virtualenv created at $VENV_DIR"
  fi
  "$VENV_DIR/bin/pip" install --upgrade pip -q
  "$VENV_DIR/bin/pip" install -r requirements.txt -q
  ok "Dependencies installed (email-validator included)"
fi

# ── Start PostgreSQL + Redis containers ───────────────────────────────────────
info "Starting PostgreSQL and Redis containers"

docker run -d \
  --name "${COMPOSE_PROJECT}_postgres" \
  --rm \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -e POSTGRES_DB="$PG_DB" \
  -p "${PG_PORT}:5432" \
  --health-cmd "pg_isready -U $PG_USER" \
  --health-interval 5s \
  --health-retries 10 \
  postgres:16-alpine 2>/dev/null || \
  docker start "${COMPOSE_PROJECT}_postgres" 2>/dev/null || true

docker run -d \
  --name "${COMPOSE_PROJECT}_redis" \
  --rm \
  -p "${REDIS_PORT}:6379" \
  --health-cmd "redis-cli ping" \
  --health-interval 5s \
  --health-retries 10 \
  redis:7-alpine 2>/dev/null || \
  docker start "${COMPOSE_PROJECT}_redis" 2>/dev/null || true

ok "Containers started"

# ── Wait for healthy ──────────────────────────────────────────────────────────
info "Waiting for PostgreSQL to be ready"
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${COMPOSE_PROJECT}_postgres" 2>/dev/null || echo "starting")
  if [[ "$STATUS" == "healthy" ]]; then
    ok "PostgreSQL is ready (${i}s)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    fail "PostgreSQL did not become healthy after 30s"
  fi
  sleep 1
done

info "Waiting for Redis to be ready"
for i in $(seq 1 15); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${COMPOSE_PROJECT}_redis" 2>/dev/null || echo "starting")
  if [[ "$STATUS" == "healthy" ]]; then
    ok "Redis is ready (${i}s)"
    break
  fi
  if [[ $i -eq 15 ]]; then
    fail "Redis did not become healthy after 15s"
  fi
  sleep 1
done

# ── --db-only: stop here ──────────────────────────────────────────────────────
if [[ "${1:-}" == "--db-only" ]]; then
  echo ""
  ok "Containers are running:"
  ok "  PostgreSQL → localhost:$PG_PORT  (user=$PG_USER password=$PG_PASSWORD db=$PG_DB)"
  ok "  Redis      → localhost:$REDIS_PORT"
  echo ""
  info "Connect strings:"
  echo "  DATABASE_URL=postgresql+asyncpg://$PG_USER:$PG_PASSWORD@localhost:$PG_PORT/$PG_DB"
  echo "  REDIS_URL=redis://localhost:$REDIS_PORT/0"
  echo ""
  info "To start the API separately: source .env && .venv/bin/uvicorn app.main:app --reload"
  info "To stop containers: bash scripts/run_hybrid.sh --stop"
  exit 0
fi

# ── Write .env ────────────────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  cp .env.example .env
fi

# Always patch the DB/Redis URLs in .env for hybrid mode
python3 - << PYEOF
import re, pathlib

env = pathlib.Path('.env').read_text()

def replace_or_append(text, key, value):
    pattern = rf'^{key}=.*$'
    if re.search(pattern, text, re.MULTILINE):
        return re.sub(pattern, f'{key}={value}', text, flags=re.MULTILINE)
    return text + f'\n{key}={value}\n'

env = replace_or_append(env, 'DATABASE_URL',
    'postgresql+asyncpg://$PG_USER:$PG_PASSWORD@localhost:$PG_PORT/$PG_DB')
env = replace_or_append(env, 'REDIS_URL',
    'redis://localhost:$REDIS_PORT/0')
env = replace_or_append(env, 'APP_ENV', 'development')

pathlib.Path('.env').write_text(env)
PYEOF

# Expand variables in .env
sed -i.bak \
  -e "s|\\\$PG_USER|$PG_USER|g" \
  -e "s|\\\$PG_PASSWORD|$PG_PASSWORD|g" \
  -e "s|\\\$PG_PORT|$PG_PORT|g" \
  -e "s|\\\$PG_DB|$PG_DB|g" \
  -e "s|\\\$REDIS_PORT|$REDIS_PORT|g" \
  .env && rm -f .env.bak

ok ".env configured for hybrid mode"

# ── Export env and start app ──────────────────────────────────────────────────
# Load .env safely without shell-evaluating values. This supports entries like:
# ALLOWED_ORIGINS=["http://localhost:5173", "http://localhost:3000"]
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  key="${key##[[:space:]]}"
  key="${key%%[[:space:]]}"
  export "$key=$value"
done < .env

echo ""
info "Container status:"
docker ps --filter "name=${COMPOSE_PROJECT}" \
  --format "  {{.Names}} → {{.Status}}" 2>/dev/null || true

echo ""
info "Starting AgentTalk API on http://localhost:$APP_PORT"
info "Swagger docs: http://localhost:$APP_PORT/docs"
info "Press Ctrl+C to stop (containers keep running — use --stop to also remove them)"
echo ""

"$VENV_DIR/bin/uvicorn" app.main:app \
  --host 0.0.0.0 \
  --port "$APP_PORT" \
  --reload \
  --reload-dir app \
  --log-level info
