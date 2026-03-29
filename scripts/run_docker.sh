#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  run_docker.sh — Full Docker mode: everything runs in containers
#
#  Closest to production. All services (API, PostgreSQL, Redis) run inside
#  Docker Compose. No local Python or database installation required.
#
#  Prerequisites:
#    - Docker Desktop or Docker Engine + Compose plugin
#
#  Usage:
#    bash scripts/run_docker.sh              # build + start all containers
#    bash scripts/run_docker.sh --rebuild    # force rebuild the API image
#    bash scripts/run_docker.sh --stop       # stop and remove containers
#    bash scripts/run_docker.sh --logs       # tail logs from all containers
#    bash scripts/run_docker.sh --logs api   # tail logs from API only
#    bash scripts/run_docker.sh --shell      # open bash inside the API container
#    bash scripts/run_docker.sh --psql       # open psql inside the DB container
#    bash scripts/run_docker.sh --status     # show container health
#    bash scripts/run_docker.sh --prod       # start production stack (nginx + 2 replicas)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
info() { echo -e "${BLUE}  ▶${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }

APP_PORT="${APP_PORT:-8000}"

# ── Docker check ──────────────────────────────────────────────────────────────
if ! docker info &>/dev/null; then
  fail "Docker is not running. Start Docker Desktop or Docker Engine first."
fi

# ── Ensure .env exists ────────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  info "Creating .env from template"
  cp .env.example .env
  warn "Review .env and set a strong SECRET_KEY before running in production"
fi

# ── Flags ─────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--stop" ]]; then
  info "Stopping all containers"
  docker compose down --remove-orphans
  ok "All containers stopped"
  exit 0
fi

if [[ "${1:-}" == "--logs" ]]; then
  SERVICE="${2:-}"
  docker compose logs -f --tail=100 $SERVICE
  exit 0
fi

if [[ "${1:-}" == "--shell" ]]; then
  info "Opening shell in API container"
  docker compose exec api bash || docker compose exec api sh
  exit 0
fi

if [[ "${1:-}" == "--psql" ]]; then
  info "Opening psql in database container"
  docker compose exec postgres psql -U agenttalk -d agenttalk
  exit 0
fi

if [[ "${1:-}" == "--status" ]]; then
  echo ""
  echo "Container status:"
  docker compose ps
  echo ""
  echo "Health checks:"
  for svc in postgres redis api; do
    ID=$(docker compose ps -q $svc 2>/dev/null || true)
    if [[ -n "$ID" ]]; then
      STATUS=$(docker inspect --format='  {{.Name}}: {{.State.Health.Status}}' "$ID" 2>/dev/null || echo "  $svc: no health check")
      echo "$STATUS"
    fi
  done
  exit 0
fi

if [[ "${1:-}" == "--prod" ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  AgentTalk — Production Stack (nginx + 2 API replicas)   ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  warn "Production mode requires TLS certificates in nginx/certs/"
  warn "See nginx/certs/README.md for setup instructions"
  echo ""

  if [[ ! -f "nginx/certs/fullchain.pem" ]]; then
    warn "No TLS cert found. Generating self-signed cert for testing..."
    mkdir -p nginx/certs
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout nginx/certs/privkey.pem \
      -out nginx/certs/fullchain.pem \
      -subj "/CN=localhost" 2>/dev/null
    ok "Self-signed cert generated (not for real production)"
  fi

  info "Starting production stack"
  docker compose -f docker-compose.prod.yml up --build -d

  echo ""
  ok "Production stack running:"
  ok "  API (2 replicas) → via nginx at https://localhost"
  ok "  PostgreSQL       → internal only"
  ok "  Redis            → internal only"
  echo ""
  info "Logs: bash scripts/run_docker.sh --logs"
  info "Stop: docker compose -f docker-compose.prod.yml down"
  exit 0
fi

if [[ "${1:-}" == "--rebuild" ]]; then
  BUILD_FLAG="--build"
else
  BUILD_FLAG=""
fi

# ── Default: start dev stack ──────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  AgentTalk — Full Docker Mode (dev)                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

info "Pulling base images (if needed)"
docker compose pull postgres redis 2>/dev/null || true

info "Building and starting all containers"
docker compose up $BUILD_FLAG -d

echo ""
info "Waiting for services to become healthy"

# Wait for postgres
for i in $(seq 1 30); do
  PG_ID=$(docker compose ps -q postgres 2>/dev/null || true)
  STATUS="starting"
  [[ -n "$PG_ID" ]] && STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$PG_ID" 2>/dev/null || echo "starting")
  if [[ "$STATUS" == "healthy" ]]; then
    ok "PostgreSQL healthy (${i}s)"
    break
  fi
  [[ $i -eq 30 ]] && fail "PostgreSQL did not become healthy"
  printf "."
  sleep 1
done

# Wait for redis
for i in $(seq 1 15); do
  R_ID=$(docker compose ps -q redis 2>/dev/null || true)
  STATUS="starting"
  [[ -n "$R_ID" ]] && STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$R_ID" 2>/dev/null || echo "starting")
  if [[ "$STATUS" == "healthy" ]]; then
    ok "Redis healthy (${i}s)"
    break
  fi
  [[ $i -eq 15 ]] && fail "Redis did not become healthy"
  printf "."
  sleep 1
done

# Wait for API
info "Waiting for API to respond"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$APP_PORT/health/live" &>/dev/null; then
    ok "API is alive (${i}s)"
    break
  fi
  [[ $i -eq 30 ]] && { warn "API did not respond in 30s — check logs: bash scripts/run_docker.sh --logs api"; }
  sleep 1
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  All services running                                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
ok "API         → http://localhost:$APP_PORT"
ok "Swagger UI  → http://localhost:$APP_PORT/docs"
ok "ReDoc       → http://localhost:$APP_PORT/redoc"
ok "Health      → http://localhost:$APP_PORT/health/ready"
ok "Metrics     → http://localhost:$APP_PORT/metrics"
echo ""
info "Useful commands:"
echo "  bash scripts/run_docker.sh --logs          # tail all logs"
echo "  bash scripts/run_docker.sh --logs api      # tail API logs only"
echo "  bash scripts/run_docker.sh --shell         # bash inside API container"
echo "  bash scripts/run_docker.sh --psql          # psql inside DB container"
echo "  bash scripts/run_docker.sh --status        # container health overview"
echo "  bash scripts/run_docker.sh --stop          # stop everything"
echo "  bash scripts/run_docker.sh --rebuild       # rebuild API image and restart"
echo ""
info "Run the walkthrough against the live stack:"
echo "  bash docs/walkthrough.sh"
echo ""
info "Following API logs (Ctrl+C to detach, containers keep running):"
docker compose logs -f api
