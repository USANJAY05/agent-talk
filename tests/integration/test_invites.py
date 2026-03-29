"""Integration tests for the Agent Invite Link + Connection Request system."""

import pytest
from httpx import AsyncClient

from tests.conftest import create_user, create_agent


@pytest.mark.asyncio
class TestInviteCreation:
    async def test_create_invite(self, client: AsyncClient):
        user = await create_user(client, "inv_owner")
        agent = await create_agent(client, user["headers"], name="inv-bot")
        res = await client.post(
            f"/api/v1/agents/{agent['id']}/invites",
            json={"label": "test invite", "max_uses": 5, "expires_in_hours": 24},
            headers=user["headers"],
        )
        assert res.status_code == 201
        data = res.json()
        assert data["label"] == "test invite"
        assert data["max_uses"] == 5
        assert data["use_count"] == 0
        assert data["is_active"] is True
        assert data["invite_url"].endswith(data["invite_code"])

    async def test_create_unlimited_invite(self, client: AsyncClient):
        user = await create_user(client, "inv_unlim")
        agent = await create_agent(client, user["headers"], name="unlim-bot")
        res = await client.post(
            f"/api/v1/agents/{agent['id']}/invites",
            json={},
            headers=user["headers"],
        )
        assert res.status_code == 201
        assert res.json()["max_uses"] is None
        assert res.json()["expires_at"] is None

    async def test_list_invites(self, client: AsyncClient):
        user = await create_user(client, "inv_list")
        agent = await create_agent(client, user["headers"], name="list-bot")
        await client.post(f"/api/v1/agents/{agent['id']}/invites", json={"label": "a"}, headers=user["headers"])
        await client.post(f"/api/v1/agents/{agent['id']}/invites", json={"label": "b"}, headers=user["headers"])
        res = await client.get(f"/api/v1/agents/{agent['id']}/invites", headers=user["headers"])
        assert res.status_code == 200
        assert len(res.json()) == 2

    async def test_revoke_invite(self, client: AsyncClient):
        user = await create_user(client, "inv_revoke")
        agent = await create_agent(client, user["headers"], name="revoke-bot")
        invite = (await client.post(
            f"/api/v1/agents/{agent['id']}/invites", json={}, headers=user["headers"]
        )).json()
        res = await client.delete(
            f"/api/v1/agents/{agent['id']}/invites/{invite['invite_code']}/revoke",
            headers=user["headers"],
        )
        assert res.status_code == 200
        assert res.json()["is_active"] is False

    async def test_non_owner_cannot_create_invite(self, client: AsyncClient):
        owner = await create_user(client, "inv_own2")
        other = await create_user(client, "inv_oth2")
        agent = await create_agent(client, owner["headers"], name="protected-inv-bot")
        res = await client.post(
            f"/api/v1/agents/{agent['id']}/invites",
            json={},
            headers=other["headers"],
        )
        assert res.status_code == 403


@pytest.mark.asyncio
class TestPublicInvitePreview:
    async def test_preview_valid_invite(self, client: AsyncClient):
        user = await create_user(client, "prev_owner")
        agent = await create_agent(client, user["headers"], name="preview-bot")
        invite = (await client.post(
            f"/api/v1/agents/{agent['id']}/invites",
            json={"label": "public invite"},
            headers=user["headers"],
        )).json()

        # No auth required
        res = await client.get(f"/api/v1/agents/invite/{invite['invite_code']}")
        assert res.status_code == 200
        data = res.json()
        assert data["agent_name"] == "preview-bot"
        assert data["owner_username"] == "prev_owner"
        assert data["is_valid"] is True
        assert data["invalid_reason"] is None

    async def test_preview_revoked_invite_shows_invalid(self, client: AsyncClient):
        user = await create_user(client, "prev_rev")
        agent = await create_agent(client, user["headers"], name="revoked-prev-bot")
        invite = (await client.post(
            f"/api/v1/agents/{agent['id']}/invites", json={}, headers=user["headers"]
        )).json()
        await client.delete(
            f"/api/v1/agents/{agent['id']}/invites/{invite['invite_code']}/revoke",
            headers=user["headers"],
        )
        res = await client.get(f"/api/v1/agents/invite/{invite['invite_code']}")
        assert res.status_code == 200
        assert res.json()["is_valid"] is False
        assert "revoked" in res.json()["invalid_reason"].lower()

    async def test_nonexistent_invite_returns_404(self, client: AsyncClient):
        res = await client.get("/api/v1/agents/invite/nonexistent-code-xyz")
        assert res.status_code == 404


@pytest.mark.asyncio
class TestConnectionRequestFlow:
    async def _setup(self, client):
        """Helper: owner + agent + invite."""
        owner = await create_user(client, "flow_owner")
        agent = await create_agent(client, owner["headers"], name="flow-bot")
        invite = (await client.post(
            f"/api/v1/agents/{agent['id']}/invites", json={}, headers=owner["headers"]
        )).json()
        return owner, agent, invite

    async def test_submit_request(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        res = await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={
                "requester_name": "prod-bot",
                "requester_description": "Production instance",
                "requester_contact": "ops@co.com",
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["status"] == "pending"
        assert data["connection_token"] is None

    async def test_submit_to_revoked_invite_fails(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        await client.delete(
            f"/api/v1/agents/{agent['id']}/invites/{invite['invite_code']}/revoke",
            headers=owner["headers"],
        )
        res = await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "sneaky-bot"},
        )
        assert res.status_code == 422

    async def test_duplicate_pending_request_rejected(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        payload = {"requester_name": "dup-bot"}
        await client.post(f"/api/v1/agents/invite/{invite['invite_code']}/request", json=payload)
        res = await client.post(f"/api/v1/agents/invite/{invite['invite_code']}/request", json=payload)
        assert res.status_code == 409

    async def test_owner_sees_pending_request(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "visible-bot"},
        )
        res = await client.get(
            f"/api/v1/agents/{agent['id']}/requests?status=pending",
            headers=owner["headers"],
        )
        assert res.status_code == 200
        assert len(res.json()) == 1
        assert res.json()[0]["requester_name"] == "visible-bot"

    async def test_approve_request_issues_token(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        req = (await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "approved-bot"},
        )).json()

        res = await client.post(
            f"/api/v1/agents/{agent['id']}/requests/{req['id']}/approve",
            headers=owner["headers"],
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "approved"
        assert data["connection_token"] is not None
        assert len(data["connection_token"]) > 20

    async def test_poll_returns_token_after_approval(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        req = (await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "polling-bot"},
        )).json()

        # Before approval — no token
        poll = await client.get(
            f"/api/v1/agents/invite/{invite['invite_code']}/request/{req['id']}/status"
        )
        assert poll.json()["status"] == "pending"
        assert poll.json()["connection_token"] is None

        # Approve
        await client.post(
            f"/api/v1/agents/{agent['id']}/requests/{req['id']}/approve",
            headers=owner["headers"],
        )

        # After approval — token present
        poll = await client.get(
            f"/api/v1/agents/invite/{invite['invite_code']}/request/{req['id']}/status"
        )
        assert poll.json()["status"] == "approved"
        assert poll.json()["connection_token"] is not None

    async def test_reject_request(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        req = (await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "rejected-bot"},
        )).json()

        res = await client.post(
            f"/api/v1/agents/{agent['id']}/requests/{req['id']}/reject",
            json={"reason": "Not accepting at this time."},
            headers=owner["headers"],
        )
        assert res.status_code == 200
        assert res.json()["status"] == "rejected"
        assert res.json()["rejection_reason"] == "Not accepting at this time."

    async def test_cannot_approve_already_rejected(self, client: AsyncClient):
        owner, agent, invite = await self._setup(client)
        req = (await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "dbl-bot"},
        )).json()
        await client.post(
            f"/api/v1/agents/{agent['id']}/requests/{req['id']}/reject",
            json={},
            headers=owner["headers"],
        )
        res = await client.post(
            f"/api/v1/agents/{agent['id']}/requests/{req['id']}/approve",
            headers=owner["headers"],
        )
        assert res.status_code == 422

    async def test_max_uses_enforced(self, client: AsyncClient):
        owner = await create_user(client, "maxuse_owner")
        agent = await create_agent(client, owner["headers"], name="maxuse-bot")
        invite = (await client.post(
            f"/api/v1/agents/{agent['id']}/invites",
            json={"max_uses": 1},
            headers=owner["headers"],
        )).json()

        # First request — succeeds
        res1 = await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "first-bot"},
        )
        assert res1.status_code == 201

        # Second request — should fail (max_uses reached)
        res2 = await client.post(
            f"/api/v1/agents/invite/{invite['invite_code']}/request",
            json={"requester_name": "second-bot"},
        )
        assert res2.status_code == 422
