"""Integration tests for authentication endpoints."""

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.conftest import create_user


@pytest.mark.asyncio
class TestRegister:
    async def test_register_success(self, client: AsyncClient):
        res = await client.post("/api/v1/auth/register", json={
            "username": "newuser",
            "email": "newuser@test.com",
            "password": "strongpass",
        })
        assert res.status_code == 201
        data = res.json()
        assert data["username"] == "newuser"
        assert data["email"] == "newuser@test.com"
        assert "id" in data
        assert "hashed_password" not in data

    async def test_register_creates_participant(self, client: AsyncClient):
        user = await create_user(client, "ptest")
        res = await client.get("/api/v1/participants/me", headers=user["headers"])
        assert res.status_code == 200
        p = res.json()
        assert p["type"] == "human"
        assert p["name"] == "ptest"

    async def test_duplicate_username_rejected(self, client: AsyncClient):
        await create_user(client, "alice")
        res = await client.post("/api/v1/auth/register", json={
            "username": "alice",
            "email": "alice2@test.com",
            "password": "strongpass",
        })
        assert res.status_code == 409

    async def test_duplicate_email_rejected(self, client: AsyncClient):
        await create_user(client, "alice")
        res = await client.post("/api/v1/auth/register", json={
            "username": "alice2",
            "email": "alice@test.com",
            "password": "strongpass",
        })
        assert res.status_code == 409

    async def test_short_password_rejected(self, client: AsyncClient):
        res = await client.post("/api/v1/auth/register", json={
            "username": "short",
            "email": "short@test.com",
            "password": "abc",
        })
        assert res.status_code == 422

    async def test_invalid_email_rejected(self, client: AsyncClient):
        res = await client.post("/api/v1/auth/register", json={
            "username": "bademail",
            "email": "not-an-email",
            "password": "strongpass",
        })
        assert res.status_code == 422


@pytest.mark.asyncio
class TestLogin:
    async def test_login_success(self, client: AsyncClient):
        await create_user(client, "logintest")
        res = await client.post("/api/v1/auth/login", data={
            "username": "logintest",
            "password": "password123",
        })
        assert res.status_code == 200
        assert "access_token" in res.json()
        assert res.json()["token_type"] == "bearer"

    async def test_wrong_password_rejected(self, client: AsyncClient):
        await create_user(client, "pwtest")
        res = await client.post("/api/v1/auth/login", data={
            "username": "pwtest",
            "password": "wrongpassword",
        })
        assert res.status_code == 401

    async def test_nonexistent_user_rejected(self, client: AsyncClient):
        res = await client.post("/api/v1/auth/login", data={
            "username": "ghost",
            "password": "password123",
        })
        assert res.status_code == 401


@pytest.mark.asyncio
class TestMe:
    async def test_get_me(self, client: AsyncClient):
        user = await create_user(client, "metest")
        res = await client.get("/api/v1/auth/me", headers=user["headers"])
        assert res.status_code == 200
        assert res.json()["username"] == "metest"

    async def test_unauthenticated_rejected(self, client: AsyncClient):
        res = await client.get("/api/v1/auth/me")
        assert res.status_code == 401

    async def test_invalid_token_rejected(self, client: AsyncClient):
        res = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"})
        assert res.status_code == 401

    async def test_update_profile(self, client: AsyncClient):
        user = await create_user(client, "profiletest")
        res = await client.patch(
            "/api/v1/auth/me?bio=Hello+World",
            headers=user["headers"],
        )
        assert res.status_code == 200
        assert res.json()["bio"] == "Hello World"
