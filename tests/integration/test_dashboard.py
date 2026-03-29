"""Integration tests for the dashboard endpoint."""

import pytest
from httpx import AsyncClient

from tests.conftest import create_user, create_agent


@pytest.mark.asyncio
class TestDashboard:
    async def test_dashboard_structure(self, client: AsyncClient):
        user = await create_user(client, "dash_user")
        res = await client.get("/api/v1/dashboard/", headers=user["headers"])
        assert res.status_code == 200
        data = res.json()
        assert "chats" in data
        assert "owned_agents" in data
        assert "accessible_agents" in data
        assert "my_participant" in data

    async def test_dashboard_reflects_created_agents(self, client: AsyncClient):
        user = await create_user(client, "dash_agents")
        await create_agent(client, user["headers"], name="dash-bot-1")
        await create_agent(client, user["headers"], name="dash-bot-2")
        res = await client.get("/api/v1/dashboard/", headers=user["headers"])
        owned = res.json()["owned_agents"]
        names = [a["name"] for a in owned]
        assert "dash-bot-1" in names
        assert "dash-bot-2" in names

    async def test_dashboard_reflects_chats(self, client: AsyncClient):
        alice = await create_user(client, "dash_alice")
        bob = await create_user(client, "dash_bob")
        await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        res = await client.get("/api/v1/dashboard/", headers=alice["headers"])
        assert len(res.json()["chats"]) >= 1

    async def test_dashboard_unauthenticated(self, client: AsyncClient):
        res = await client.get("/api/v1/dashboard/")
        assert res.status_code == 401
