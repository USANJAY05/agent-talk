"""
Shared pytest fixtures for AgentTalk tests.

Uses an in-memory SQLite database for unit/integration tests so no
running PostgreSQL or Redis instance is required for the test suite.
"""

import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.session import Base
from app.core.deps import get_db
from app.main import app

# ── In-memory SQLite engine for tests ────────────────────────────────────────
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@pytest.fixture(scope="session")
def event_loop():
    """Use a single event loop for the whole test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Fresh schema + session per test function."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestSessionLocal() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    AsyncClient with the FastAPI app wired to the test DB session.
    Redis pub/sub calls are mocked out.
    """
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    # Mock Redis so tests don't need a running Redis instance
    with patch("app.db.redis.get_redis") as mock_redis:
        mock_redis.return_value = AsyncMock()
        with patch("app.db.redis.publish", new_callable=AsyncMock):
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test",
            ) as ac:
                yield ac

    app.dependency_overrides.clear()


# ── Convenience helpers ───────────────────────────────────────────────────────

async def create_user(client: AsyncClient, username: str = "testuser", password: str = "password123") -> dict:
    """Register + login, return {token, account, participant}."""
    reg = await client.post("/api/v1/auth/register", json={
        "username": username,
        "email": f"{username}@test.com",
        "password": password,
    })
    assert reg.status_code == 201, reg.text

    login = await client.post("/api/v1/auth/login", data={
        "username": username,
        "password": password,
    })
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    participant = await client.get("/api/v1/participants/me", headers={"Authorization": f"Bearer {token}"})

    return {
        "token": token,
        "headers": {"Authorization": f"Bearer {token}"},
        "account": me.json(),
        "participant": participant.json(),
    }


async def create_agent(client: AsyncClient, headers: dict, name: str = "test-bot", visibility: str = "private") -> dict:
    """Create an agent, return agent JSON."""
    res = await client.post("/api/v1/agents/", json={
        "name": name,
        "description": "A test agent",
        "visibility": visibility,
        "passive_listen": False,
    }, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()
