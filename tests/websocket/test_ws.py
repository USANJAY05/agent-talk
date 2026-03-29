"""
WebSocket integration tests.

Uses httpx's WebSocket support to test the WS handshake and basic event flow.
Redis pub/sub is mocked — these tests verify protocol correctness, not
multi-instance fan-out (which requires a running Redis instance).
"""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient

from tests.conftest import create_user, create_agent


async def _get_ws_token(client: AsyncClient, username: str) -> tuple[str, dict, dict]:
    """Register, login, return (token, headers, participant)."""
    user = await create_user(client, username)
    return user["token"], user["headers"], user["participant"]


@pytest.mark.asyncio
class TestChatWebSocket:
    async def test_ws_rejects_missing_token(self, client: AsyncClient):
        alice = await create_user(client, "ws_notoken")
        bob = await create_user(client, "ws_notoken_bob")
        chat = (await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])).json()

        # No token param → FastAPI rejects with 422 before WS upgrade
        res = await client.get(f"/ws/chat/{chat['id']}")
        assert res.status_code in (400, 422, 403)

    async def test_ws_rejects_non_member(self, client: AsyncClient):
        """
        Connect to a chat the token-holder is NOT a member of.
        Server should send an error event and close.
        """
        alice = await create_user(client, "ws_member_a")
        bob = await create_user(client, "ws_member_b")
        carol = await create_user(client, "ws_nonmember")

        chat = (await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])).json()

        # Carol tries to connect to Alice+Bob's chat
        async with client.websocket_connect(
            f"/ws/chat/{chat['id']}?token={carol['token']}"
        ) as ws:
            msg = json.loads(await ws.receive_text())
            assert msg["event"] == "error"
            assert "member" in msg["detail"].lower()

    async def test_ws_accepts_valid_member(self, client: AsyncClient):
        alice = await create_user(client, "ws_valid_a")
        bob = await create_user(client, "ws_valid_b")
        chat = (await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])).json()

        with patch("app.websocket.chat_ws.subscribe") as mock_sub, \
             patch("app.websocket.chat_ws.publish", new_callable=AsyncMock):
            # Make subscribe return an empty async generator (no Redis messages)
            async def empty_gen(*args, **kwargs):
                return
                yield  # make it a generator
            mock_sub.return_value = empty_gen()

            async with client.websocket_connect(
                f"/ws/chat/{chat['id']}?token={alice['token']}"
            ) as ws:
                # Send a typing event — should get no error
                await ws.send_text(json.dumps({
                    "event": "typing_event",
                    "is_typing": True,
                }))
                # Connection stays open (no error message for typing)
                # We just verify no immediate error is thrown
                await ws.aclose()


@pytest.mark.asyncio
class TestAgentWebSocket:
    async def test_agent_ws_rejects_invalid_token(self, client: AsyncClient):
        async with client.websocket_connect("/ws/agent/connect") as ws:
            await ws.send_text(json.dumps({"token": "garbage.token.value"}))
            msg = json.loads(await ws.receive_text())
            assert msg["event"] == "error"

    async def test_agent_ws_rejects_missing_token_field(self, client: AsyncClient):
        async with client.websocket_connect("/ws/agent/connect") as ws:
            await ws.send_text(json.dumps({"wrong_field": "value"}))
            msg = json.loads(await ws.receive_text())
            assert msg["event"] == "error"

    async def test_agent_ws_rejects_already_used_token(self, client: AsyncClient):
        """
        Issue a token, mark it used in DB, then try to connect — should fail.
        """
        user = await create_user(client, "ws_agent_used")
        agent = await create_agent(client, user["headers"], name="used-token-bot")

        token_res = await client.post(
            f"/api/v1/agents/{agent['id']}/tokens",
            headers=user["headers"],
        )
        raw_token = token_res.json()["token"]

        # First connection — consumes the token
        with patch("app.websocket.agent_ws.subscribe") as mock_sub, \
             patch("app.websocket.agent_ws.publish", new_callable=AsyncMock):
            async def empty_gen(*args, **kwargs):
                return
                yield
            mock_sub.return_value = empty_gen()

            async with client.websocket_connect("/ws/agent/connect") as ws:
                await ws.send_text(json.dumps({"token": raw_token}))
                msg = json.loads(await ws.receive_text())
                # Should be connected
                assert msg["event"] == "connected"

        # Second connection with same token — should fail
        async with client.websocket_connect("/ws/agent/connect") as ws:
            await ws.send_text(json.dumps({"token": raw_token}))
            msg = json.loads(await ws.receive_text())
            assert msg["event"] == "error"
            assert "already used" in msg["detail"].lower()

    async def test_agent_ws_handshake_success(self, client: AsyncClient):
        user = await create_user(client, "ws_agent_ok")
        agent = await create_agent(client, user["headers"], name="ok-bot")
        token_res = await client.post(
            f"/api/v1/agents/{agent['id']}/tokens",
            headers=user["headers"],
        )
        raw_token = token_res.json()["token"]

        with patch("app.websocket.agent_ws.subscribe") as mock_sub, \
             patch("app.websocket.agent_ws.publish", new_callable=AsyncMock):
            async def empty_gen(*args, **kwargs):
                return
                yield
            mock_sub.return_value = empty_gen()

            async with client.websocket_connect("/ws/agent/connect") as ws:
                await ws.send_text(json.dumps({"token": raw_token}))
                msg = json.loads(await ws.receive_text())
                assert msg["event"] == "connected"
                assert msg["agent_id"] == str(agent["id"])
                assert "participant_id" in msg
