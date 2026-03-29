"""Integration tests for agent management endpoints."""

import pytest
from httpx import AsyncClient

from tests.conftest import create_user, create_agent


@pytest.mark.asyncio
class TestAgentCRUD:
    async def test_create_agent(self, client: AsyncClient):
        user = await create_user(client, "agentowner")
        agent = await create_agent(client, user["headers"], name="my-bot")
        assert agent["name"] == "my-bot"
        assert agent["owner_id"] == user["account"]["id"]
        assert agent["visibility"] == "private"
        assert "participant_id" in agent

    async def test_agent_creates_participant(self, client: AsyncClient):
        user = await create_user(client, "owner2")
        agent = await create_agent(client, user["headers"], name="linked-bot")
        # Verify the linked participant exists and has type 'agent'
        res = await client.get(
            f"/api/v1/participants/{agent['participant_id']}",
            headers=user["headers"],
        )
        assert res.status_code == 200
        assert res.json()["type"] == "agent"
        assert res.json()["name"] == "linked-bot"

    async def test_list_owned_agents(self, client: AsyncClient):
        user = await create_user(client, "listowner")
        await create_agent(client, user["headers"], name="bot-a")
        await create_agent(client, user["headers"], name="bot-b")
        res = await client.get("/api/v1/agents/mine", headers=user["headers"])
        assert res.status_code == 200
        names = [a["name"] for a in res.json()]
        assert "bot-a" in names
        assert "bot-b" in names

    async def test_update_agent(self, client: AsyncClient):
        user = await create_user(client, "updateowner")
        agent = await create_agent(client, user["headers"], name="old-name")
        res = await client.patch(
            f"/api/v1/agents/{agent['id']}",
            json={"name": "new-name", "visibility": "public"},
            headers=user["headers"],
        )
        assert res.status_code == 200
        assert res.json()["name"] == "new-name"
        assert res.json()["visibility"] == "public"

    async def test_delete_agent(self, client: AsyncClient):
        user = await create_user(client, "deleteowner")
        agent = await create_agent(client, user["headers"], name="to-delete")
        res = await client.delete(f"/api/v1/agents/{agent['id']}", headers=user["headers"])
        assert res.status_code == 204
        res2 = await client.get(f"/api/v1/agents/{agent['id']}", headers=user["headers"])
        assert res2.status_code == 404

    async def test_other_user_cannot_update(self, client: AsyncClient):
        owner = await create_user(client, "owner3")
        other = await create_user(client, "other3")
        agent = await create_agent(client, owner["headers"], name="protected-bot")
        res = await client.patch(
            f"/api/v1/agents/{agent['id']}",
            json={"name": "hijacked"},
            headers=other["headers"],
        )
        assert res.status_code == 403

    async def test_other_user_cannot_delete(self, client: AsyncClient):
        owner = await create_user(client, "owner4")
        other = await create_user(client, "other4")
        agent = await create_agent(client, owner["headers"], name="nodestroy-bot")
        res = await client.delete(f"/api/v1/agents/{agent['id']}", headers=other["headers"])
        assert res.status_code == 403

    async def test_private_agent_invisible_to_others(self, client: AsyncClient):
        owner = await create_user(client, "privateowner")
        other = await create_user(client, "notallowed")
        agent = await create_agent(client, owner["headers"], name="secret-bot", visibility="private")
        res = await client.get(f"/api/v1/agents/{agent['id']}", headers=other["headers"])
        assert res.status_code == 403

    async def test_public_agent_visible_to_all(self, client: AsyncClient):
        owner = await create_user(client, "pubowner")
        other = await create_user(client, "pubother")
        agent = await create_agent(client, owner["headers"], name="public-bot", visibility="public")
        res = await client.get(f"/api/v1/agents/{agent['id']}", headers=other["headers"])
        assert res.status_code == 200


@pytest.mark.asyncio
class TestAgentTokens:
    async def test_generate_token(self, client: AsyncClient):
        user = await create_user(client, "tokenowner")
        agent = await create_agent(client, user["headers"], name="token-bot")
        res = await client.post(
            f"/api/v1/agents/{agent['id']}/tokens",
            headers=user["headers"],
        )
        assert res.status_code == 201
        data = res.json()
        assert "token" in data
        assert "expires_at" in data
        assert len(data["token"]) > 20

    async def test_non_owner_cannot_generate_token(self, client: AsyncClient):
        owner = await create_user(client, "tokenown2")
        thief = await create_user(client, "thief2")
        agent = await create_agent(client, owner["headers"], name="secure-bot")
        res = await client.post(
            f"/api/v1/agents/{agent['id']}/tokens",
            headers=thief["headers"],
        )
        assert res.status_code == 403


@pytest.mark.asyncio
class TestAgentVisibility:
    async def test_accessible_agents_includes_public(self, client: AsyncClient):
        owner = await create_user(client, "pubvis_owner")
        viewer = await create_user(client, "pubvis_viewer")
        await create_agent(client, owner["headers"], name="pub-bot", visibility="public")
        res = await client.get("/api/v1/agents/accessible", headers=viewer["headers"])
        assert res.status_code == 200
        names = [a["name"] for a in res.json()]
        assert "pub-bot" in names

    async def test_shared_agent_visible_after_grant(self, client: AsyncClient):
        owner = await create_user(client, "share_owner")
        grantee = await create_user(client, "grantee")
        agent = await create_agent(client, owner["headers"], name="shared-bot", visibility="shared")

        # Grant access
        await client.post(
            f"/api/v1/agents/{agent['id']}/access",
            json={"account_id": grantee["account"]["id"]},
            headers=owner["headers"],
        )
        res = await client.get("/api/v1/agents/accessible", headers=grantee["headers"])
        names = [a["name"] for a in res.json()]
        assert "shared-bot" in names

    async def test_revoke_shared_access(self, client: AsyncClient):
        owner = await create_user(client, "revoke_owner")
        grantee = await create_user(client, "revoke_grantee")
        agent = await create_agent(client, owner["headers"], name="revoked-bot", visibility="shared")

        await client.post(
            f"/api/v1/agents/{agent['id']}/access",
            json={"account_id": grantee["account"]["id"]},
            headers=owner["headers"],
        )
        await client.delete(
            f"/api/v1/agents/{agent['id']}/access/{grantee['account']['id']}",
            headers=owner["headers"],
        )
        res = await client.get(f"/api/v1/agents/{agent['id']}", headers=grantee["headers"])
        assert res.status_code == 403
