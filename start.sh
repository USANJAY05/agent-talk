#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  start.sh — AgentTalk unified launcher
#
#  Runs BOTH frontend and backend together in any mode.
#
#  Usage:
#    bash start.sh               → hybrid (recommended): DB in Docker, app local
#    bash start.sh docker        → everything in Docker (no local deps needed)
#    bash start.sh local         → fully local (needs PG + Redis installed)
#    bash start.sh setup         → first-time setup then start (hybrid)
#    bash start.sh stop          → stop everything
#    bash start.sh build         → build frontend for production
#
#  Prerequisites by mode:
#    hybrid / local : Node.js 18+, Python 3.12+
#    docker         : Docker only
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")"

# ── Colours ───────────────────────────────────────────────────────────────────
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m' C='\033[0;36m' N='\033[0m'
ok()   { echo -e "${G}  ✓${N} $*"; }
info() { echo -e "${B}  ▶${N} $*"; }
warn() { echo -e "${Y}  ⚠${N} $*"; }
fail() { echo -e "${R}  ✗${N} $*"; exit 1; }
hr()   { echo -e "${B}──────────────────────────────────────────────────${N}"; }

MODE="${1:-hybrid}"

# ── PID tracking ─────────────────────────────────────────────────────────────
PIDS_FILE=".running.pids"
API_PID_FILE=".api.pid"
FE_PID_FILE=".fe.pid"

cleanup() {
  info "Shutting down…"
  [[ -f "$API_PID_FILE" ]] && kill "$(cat $API_PID_FILE)" 2>/dev/null || true
  [[ -f "$FE_PID_FILE"  ]] && kill "$(cat $FE_PID_FILE)"  2>/dev/null || true
  rm -f "$API_PID_FILE" "$FE_PID_FILE"
  echo -e "${G}  Stopped.${N}"
}
trap cleanup EXIT INT TERM

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "stop" ]]; then
  info "Stopping services"
  [[ -f "$API_PID_FILE" ]] && { kill "$(cat $API_PID_FILE)" 2>/dev/null; ok "API stopped"; rm -f "$API_PID_FILE"; } || warn "API not running"
  [[ -f "$FE_PID_FILE"  ]] && { kill "$(cat $FE_PID_FILE)"  2>/dev/null; ok "Frontend stopped"; rm -f "$FE_PID_FILE"; } || warn "Frontend not running"
  docker compose stop 2>/dev/null || true
  trap - EXIT
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "build" ]]; then
  info "Building frontend for production"
  cd frontend && npm run build
  ok "Build complete → frontend/dist/"
  trap - EXIT
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}╔══════════════════════════════════════════════════╗${N}"
echo -e "${C}║           AgentTalk  ·  Full Stack               ║${N}"
echo -e "${C}╚══════════════════════════════════════════════════╝${N}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
#  DOCKER MODE — everything containerised
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "docker" ]]; then
  command -v docker &>/dev/null || fail "Docker required. Install Docker Desktop."
  docker info &>/dev/null       || fail "Docker daemon not running."

  hr
  info "Mode: Docker (all services containerised)"
  hr

  [[ ! -f ".env" ]] && cp .env.example .env && warn "Created .env — review it"

  info "Building and starting all containers"
  docker compose up --build -d

  info "Waiting for API…"
  for i in $(seq 1 40); do
    curl -sf http://localhost:8000/health/live &>/dev/null && break
    sleep 1; printf "."
  done; echo ""
  ok "API ready"

  info "Waiting for Frontend…"
  for i in $(seq 1 40); do
    curl -sf http://localhost:5173 &>/dev/null && break
    sleep 1; printf "."
  done; echo ""

  hr
  echo ""
  ok "🚀 AgentTalk running"
  echo ""
  echo -e "  ${C}Frontend${N}   →  http://localhost:5173"
  echo -e "  ${C}API${N}        →  http://localhost:8000"
  echo -e "  ${C}API Docs${N}   →  http://localhost:8000/docs"
  echo ""
  info "Logs: docker compose logs -f"
  info "Stop: bash start.sh stop  or  docker compose down"
  echo ""
  trap - EXIT
  docker compose logs -f
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
#  LOCAL / HYBRID — need Node + Python locally
# ─────────────────────────────────────────────────────────────────────────────

# Check Node
command -v node &>/dev/null || fail "Node.js 18+ required. Install from https://nodejs.org"
NODE_VER=$(node --version)
ok "Node $NODE_VER"

# Check Python
PYTHON=$(command -v python3.12 || command -v python3 || fail "Python 3.12+ required")
PY_VER=$($PYTHON --version)
ok "$PY_VER at $PYTHON"

VENV=".venv"

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "setup" || ! -f "$VENV/bin/uvicorn" ]]; then
  hr
  info "Setting up Python environment"
  [[ ! -d "$VENV" ]] && $PYTHON -m venv "$VENV" && ok "Virtualenv created"
  "$VENV/bin/pip" install --upgrade pip -q
  "$VENV/bin/pip" install -r requirements.txt -q
  ok "Python deps installed (includes email-validator)"
fi

if [[ "$MODE" == "setup" || ! -d "frontend/node_modules" ]]; then
  hr
  info "Installing frontend dependencies"
  cd frontend && npm install && cd ..
  ok "Node modules installed"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  Start infrastructure
# ─────────────────────────────────────────────────────────────────────────────
hr

if [[ "$MODE" == "local" ]]; then
  info "Mode: Local — checking PostgreSQL and Redis"
  pg_isready -h localhost -p 5432 -q 2>/dev/null || fail "PostgreSQL not running locally.\n  macOS: brew services start postgresql@16\n  Linux: sudo systemctl start postgresql"
  redis-cli ping 2>/dev/null | grep -q PONG || fail "Redis not running locally.\n  macOS: brew services start redis\n  Linux: sudo systemctl start redis"
  ok "PostgreSQL and Redis are running"
else
  info "Mode: Hybrid — starting PostgreSQL and Redis in Docker"
  command -v docker &>/dev/null || fail "Docker required for hybrid mode."
  docker info &>/dev/null       || fail "Docker daemon not running."

  docker run -d --name at_postgres --rm \
    -e POSTGRES_USER=agenttalk -e POSTGRES_PASSWORD=agenttalk -e POSTGRES_DB=agenttalk \
    -p 5432:5432 \
    --health-cmd "pg_isready -U agenttalk" --health-interval 5s --health-retries 10 \
    postgres:16-alpine 2>/dev/null || docker start at_postgres 2>/dev/null || true

  docker run -d --name at_redis --rm \
    -p 6379:6379 \
    --health-cmd "redis-cli ping" --health-interval 5s --health-retries 10 \
    redis:7-alpine 2>/dev/null || docker start at_redis 2>/dev/null || true

  info "Waiting for PostgreSQL…"
  for i in $(seq 1 30); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' at_postgres 2>/dev/null || echo "wait")
    [[ "$STATUS" == "healthy" ]] && break
    sleep 1; printf "."
  done; echo ""
  ok "PostgreSQL ready"

  info "Waiting for Redis…"
  for i in $(seq 1 15); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' at_redis 2>/dev/null || echo "wait")
    [[ "$STATUS" == "healthy" ]] && break
    sleep 1; printf "."
  done; echo ""
  ok "Redis ready"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  Write .env
# ─────────────────────────────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  sed -i.bak \
    -e 's|DATABASE_URL=.*|DATABASE_URL=postgresql+asyncpg://agenttalk:agenttalk@localhost:5432/agenttalk|' \
    -e 's|REDIS_URL=.*|REDIS_URL=redis://localhost:6379/0|' \
    -e 's|APP_ENV=.*|APP_ENV=development|' \
    -e 's|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000|' \
    .env && rm -f .env.bak
  ok ".env created"
fi

# ── Repair .env if ALLOWED_ORIGINS is in broken JSON array format ──────────────
# This fixes .env files created by an older version of start.sh
python3 -c "
import re, json, pathlib
p = pathlib.Path('.env')
if not p.exists(): exit()
content = p.read_text()
def fix(m):
    v = m.group(1).strip()
    if v.startswith('['):
        try:
            return 'ALLOWED_ORIGINS=' + ','.join(json.loads(v))
        except: pass
    return m.group(0)
fixed = re.sub(r'ALLOWED_ORIGINS=(.+)', fix, content)
if fixed != content:
    p.write_text(fixed)
    print('  Repaired ALLOWED_ORIGINS format in .env')
"

set -a; source .env; set +a

# ─────────────────────────────────────────────────────────────────────────────
#  Start backend
# ─────────────────────────────────────────────────────────────────────────────
hr
info "Starting backend (port 8000)"
"$VENV/bin/uvicorn" app.main:app \
  --host 0.0.0.0 --port 8000 --reload --reload-dir app --log-level warning \
  > /tmp/agenttalk-api.log 2>&1 &
echo $! > "$API_PID_FILE"

# Wait for API
for i in $(seq 1 30); do
  curl -sf http://localhost:8000/health/live &>/dev/null && break
  sleep 1; printf "."
done; echo ""
ok "Backend running (PID $(cat $API_PID_FILE))"

# ─────────────────────────────────────────────────────────────────────────────
#  Start frontend
# ─────────────────────────────────────────────────────────────────────────────
info "Starting frontend dev server (port 5173)"
cd frontend
npm run dev -- --host 0.0.0.0 > /tmp/agenttalk-fe.log 2>&1 &
echo $! > "../$FE_PID_FILE"
cd ..

# Wait for frontend
for i in $(seq 1 30); do
  curl -sf http://localhost:5173 &>/dev/null && break
  sleep 1; printf "."
done; echo ""
ok "Frontend running (PID $(cat $FE_PID_FILE))"

# ─────────────────────────────────────────────────────────────────────────────
#  Ready
# ─────────────────────────────────────────────────────────────────────────────
hr
echo ""
echo -e "${G}  🚀 AgentTalk is running!${N}"
echo ""
echo -e "  ${C}App${N}          →  ${G}http://localhost:5173${N}  ← open this"
echo -e "  ${C}API${N}          →  http://localhost:8000"
echo -e "  ${C}API Docs${N}     →  http://localhost:8000/docs"
echo -e "  ${C}Health${N}       →  http://localhost:8000/health/ready"
echo ""
echo -e "  ${Y}Logs${N}         →  /tmp/agenttalk-api.log  /tmp/agenttalk-fe.log"
echo -e "  ${Y}Stop${N}         →  Ctrl+C"
echo ""

# Tail both logs
tail -f /tmp/agenttalk-api.log /tmp/agenttalk-fe.log &
TAIL_PID=$!

# Wait for Ctrl+C
wait "$TAIL_PID" 2>/dev/null || true
