.PHONY: help install setup dev run test test-unit test-integration test-ws test-cov \
        lint fmt migrate migration \
        local local-setup \
        hybrid hybrid-setup hybrid-stop hybrid-db \
        docker docker-rebuild docker-stop docker-logs docker-shell docker-psql docker-status docker-prod \
        walkthrough

# ── Default ───────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  AgentTalk — Makefile targets"
	@echo ""
	@echo "  ── Run modes ────────────────────────────────────────────────────"
	@echo "  local              Start app locally (needs local PG + Redis)"
	@echo "  local-setup        First-time local setup (venv + DB + install), then start"
	@echo ""
	@echo "  hybrid             Start DB/Redis in Docker, app locally (recommended for dev)"
	@echo "  hybrid-setup       First-time hybrid setup (install deps), then start"
	@echo "  hybrid-stop        Stop API + remove containers"
	@echo "  hybrid-db          Start only DB/Redis containers (start app manually)"
	@echo ""
	@echo "  docker             Build + start everything in Docker (dev)"
	@echo "  docker-rebuild     Force rebuild API image, then start"
	@echo "  docker-stop        Stop and remove all containers"
	@echo "  docker-logs        Tail all container logs"
	@echo "  docker-shell       Open bash inside API container"
	@echo "  docker-psql        Open psql inside DB container"
	@echo "  docker-status      Show container health"
	@echo "  docker-prod        Start production stack (nginx + 2 replicas)"
	@echo ""
	@echo "  ── Dev ──────────────────────────────────────────────────────────"
	@echo "  install            pip install -r requirements.txt"
	@echo "  walkthrough        Run end-to-end curl walkthrough against live API"
	@echo ""
	@echo "  ── Test ─────────────────────────────────────────────────────────"
	@echo "  test               Run all 92 tests"
	@echo "  test-unit          Unit tests only (no DB required)"
	@echo "  test-integration   Integration tests (in-memory SQLite)"
	@echo "  test-ws            WebSocket tests"
	@echo "  test-cov           Tests with HTML coverage report"
	@echo ""
	@echo "  ── Code quality ─────────────────────────────────────────────────"
	@echo "  lint               Run ruff linter"
	@echo "  fmt                Run ruff formatter"
	@echo ""
	@echo "  ── Database ─────────────────────────────────────────────────────"
	@echo "  migrate            Apply Alembic migrations"
	@echo "  migration msg=''   Create new migration (set msg='description')"
	@echo ""

# ── Install ───────────────────────────────────────────────────────────────────
install:
	pip install -r requirements.txt

# ── Local mode ────────────────────────────────────────────────────────────────
local:
	bash scripts/run_local.sh

local-setup:
	bash scripts/run_local.sh --setup

# ── Hybrid mode ───────────────────────────────────────────────────────────────
hybrid:
	bash scripts/run_hybrid.sh

hybrid-setup:
	bash scripts/run_hybrid.sh --setup

hybrid-stop:
	bash scripts/run_hybrid.sh --stop

hybrid-db:
	bash scripts/run_hybrid.sh --db-only

# ── Docker mode ───────────────────────────────────────────────────────────────
docker:
	bash scripts/run_docker.sh

docker-rebuild:
	bash scripts/run_docker.sh --rebuild

docker-stop:
	bash scripts/run_docker.sh --stop

docker-logs:
	bash scripts/run_docker.sh --logs

docker-shell:
	bash scripts/run_docker.sh --shell

docker-psql:
	bash scripts/run_docker.sh --psql

docker-status:
	bash scripts/run_docker.sh --status

docker-prod:
	bash scripts/run_docker.sh --prod

# ── Test ──────────────────────────────────────────────────────────────────────
test:
	APP_ENV=test pytest

test-unit:
	APP_ENV=test pytest tests/unit/ -v

test-integration:
	APP_ENV=test pytest tests/integration/ -v

test-ws:
	APP_ENV=test pytest tests/websocket/ -v

test-cov:
	APP_ENV=test pytest --cov=app --cov-report=html --cov-report=term-missing
	@echo "Coverage report: htmlcov/index.html"

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	ruff check app/ tests/

fmt:
	ruff format app/ tests/

# ── Database ──────────────────────────────────────────────────────────────────
migrate:
	alembic upgrade head

migration:
	@if [ -z "$(msg)" ]; then echo "Usage: make migration msg='your message'"; exit 1; fi
	alembic revision --autogenerate -m "$(msg)"

# ── Walkthrough ───────────────────────────────────────────────────────────────
walkthrough:
	bash docs/walkthrough.sh

# ── Unified start (frontend + backend) ───────────────────────────────────────
start:
	bash start.sh

start-docker:
	bash start.sh docker

start-local:
	bash start.sh local

start-setup:
	bash start.sh setup

stop:
	bash start.sh stop

build-frontend:
	bash start.sh build
