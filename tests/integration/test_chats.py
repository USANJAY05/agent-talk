"""Integration tests for chat and group management endpoints."""

import pytest
from httpx import AsyncClient

from tests.conftest import create_user, create_agent


@pytest.mark.asyncio
class TestDirectChats:
    async def test_create_direct_chat(self, client: AsyncClient):
        alice = await create_user(client, "alice_dc")
        bob = await create_user(client, "bob_dc")
        res = await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        assert res.status_code == 201
        chat = res.json()
        assert chat["type"] == "direct"

    async def test_direct_chat_idempotent(self, client: AsyncClient):
        alice = await create_user(client, "alice_idem")
        bob = await create_user(client, "bob_idem")
        res1 = await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        res2 = await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        assert res1.status_code == 201
        assert res2.status_code == 201
        # Should return the SAME chat
        assert res1.json()["id"] == res2.json()["id"]

    async def test_list_chats(self, client: AsyncClient):
        alice = await create_user(client, "alice_list")
        bob = await create_user(client, "bob_list")
        await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        res = await client.get("/api/v1/chats/", headers=alice["headers"])
        assert res.status_code == 200
        assert len(res.json()) >= 1

    async def test_non_member_cannot_access_chat(self, client: AsyncClient):
        alice = await create_user(client, "alice_access")
        bob = await create_user(client, "bob_access")
        carol = await create_user(client, "carol_access")
        chat = await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        chat_id = chat.json()["id"]
        res = await client.get(f"/api/v1/chats/{chat_id}", headers=carol["headers"])
        assert res.status_code == 403


@pytest.mark.asyncio
class TestGroupChats:
    async def test_create_group(self, client: AsyncClient):
        alice = await create_user(client, "alice_grp")
        bob = await create_user(client, "bob_grp")
        res = await client.post("/api/v1/chats/group", json={
            "name": "Team Chat",
            "participant_ids": [bob["participant"]["id"]],
        }, headers=alice["headers"])
        assert res.status_code == 201
        assert res.json()["type"] == "group"
        assert res.json()["name"] == "Team Chat"

    async def test_creator_is_admin(self, client: AsyncClient):
        alice = await create_user(client, "alice_adm")
        res = await client.post("/api/v1/chats/group", json={
            "name": "Admin Test",
            "participant_ids": [],
        }, headers=alice["headers"])
        chat_id = res.json()["id"]
        members = await client.get(f"/api/v1/chats/{chat_id}/members", headers=alice["headers"])
        alice_member = next(m for m in members.json() if m["participant_id"] == alice["participant"]["id"])
        assert alice_member["role"] == "admin"

    async def test_add_member(self, client: AsyncClient):
        alice = await create_user(client, "alice_add")
        bob = await create_user(client, "bob_add")
        carol = await create_user(client, "carol_add")
        group = await client.post("/api/v1/chats/group", json={
            "name": "Add Test",
            "participant_ids": [bob["participant"]["id"]],
        }, headers=alice["headers"])
        chat_id = group.json()["id"]

        res = await client.post(f"/api/v1/chats/{chat_id}/members", json={
            "participant_id": carol["participant"]["id"],
            "role": "member",
        }, headers=alice["headers"])
        assert res.status_code == 201

        members = await client.get(f"/api/v1/chats/{chat_id}/members", headers=alice["headers"])
        pids = [m["participant_id"] for m in members.json()]
        assert carol["participant"]["id"] in pids

    async def test_non_admin_cannot_add_member(self, client: AsyncClient):
        alice = await create_user(client, "alice_nadm")
        bob = await create_user(client, "bob_nadm")
        carol = await create_user(client, "carol_nadm")
        group = await client.post("/api/v1/chats/group", json={
            "name": "NoAdmin Test",
            "participant_ids": [bob["participant"]["id"]],
        }, headers=alice["headers"])
        chat_id = group.json()["id"]
        res = await client.post(f"/api/v1/chats/{chat_id}/members", json={
            "participant_id": carol["participant"]["id"],
        }, headers=bob["headers"])
        assert res.status_code == 403

    async def test_remove_member(self, client: AsyncClient):
        alice = await create_user(client, "alice_rem")
        bob = await create_user(client, "bob_rem")
        group = await client.post("/api/v1/chats/group", json={
            "name": "Remove Test",
            "participant_ids": [bob["participant"]["id"]],
        }, headers=alice["headers"])
        chat_id = group.json()["id"]
        res = await client.delete(
            f"/api/v1/chats/{chat_id}/members/{bob['participant']['id']}",
            headers=alice["headers"],
        )
        assert res.status_code == 204

    async def test_agent_can_be_added_to_group(self, client: AsyncClient):
        alice = await create_user(client, "alice_agnt")
        agent = await create_agent(client, alice["headers"], name="grp-bot", visibility="private")
        group = await client.post("/api/v1/chats/group", json={
            "name": "Agent Group",
            "participant_ids": [],
        }, headers=alice["headers"])
        chat_id = group.json()["id"]
        res = await client.post(f"/api/v1/chats/{chat_id}/members", json={
            "participant_id": agent["participant_id"],
        }, headers=alice["headers"])
        assert res.status_code == 201


@pytest.mark.asyncio
class TestMessages:
    async def test_empty_history(self, client: AsyncClient):
        alice = await create_user(client, "alice_msg")
        bob = await create_user(client, "bob_msg")
        chat = await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        chat_id = chat.json()["id"]
        res = await client.get(
            f"/api/v1/messages/{chat_id}/messages",
            headers=alice["headers"],
        )
        assert res.status_code == 200
        assert res.json()["total"] == 0
        assert res.json()["items"] == []

    async def test_non_member_cannot_read_messages(self, client: AsyncClient):
        alice = await create_user(client, "alice_noread")
        bob = await create_user(client, "bob_noread")
        carol = await create_user(client, "carol_noread")
        chat = await client.post("/api/v1/chats/direct", json={
            "target_participant_id": bob["participant"]["id"],
        }, headers=alice["headers"])
        chat_id = chat.json()["id"]
        res = await client.get(
            f"/api/v1/messages/{chat_id}/messages",
            headers=carol["headers"],
        )
        assert res.status_code == 403
