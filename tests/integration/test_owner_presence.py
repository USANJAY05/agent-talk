"""
Integration tests for the Owner Presence feature.

Verifies that an agent owner is automatically enrolled as a chat member
in every conversation their agent joins, across all admission paths.
"""

import pytest
from httpx import AsyncClient

from tests.conftest import create_user, create_agent


async def _get_member_ids(client: AsyncClient, chat_id: str, headers: dict) -> set[str]:
    """Return the set of participant IDs currently in a chat."""
    res = await client.get(f"/api/v1/chats/{chat_id}/members", headers=headers)
    assert res.status_code == 200
    return {m["participant_id"] for m in res.json()}


@pytest.mark.asyncio
class TestOwnerPresenceDirectChat:
    async def test_owner_auto_added_when_agent_is_target_of_direct_chat(self, client: AsyncClient):
        """
        Alice opens a direct chat WITH the agent.
        The agent's owner (Bob) should be auto-added as a member.
        """
        bob = await create_user(client, "op_bob_dc")
        agent = await create_agent(client, bob["headers"], name="dc-agent")

        alice = await create_user(client, "op_alice_dc")
        chat = (await client.post("/api/v1/chats/direct", json={
            "target_participant_id": agent["participant_id"],
        }, headers=alice["headers"])).json()

        member_ids = await _get_member_ids(client, chat["id"], alice["headers"])

        # All three should be present
        assert alice["participant"]["id"] in member_ids,  "Alice missing"
        assert agent["participant_id"] in member_ids,     "Agent missing"
        assert bob["participant"]["id"] in member_ids,    "Owner (Bob) missing — owner presence failed"

    async def test_owner_auto_added_when_agent_initiates_direct_chat(self, client: AsyncClient):
        """
        Bob (owner) opens a direct chat from the human side, targeting another human.
        No agent involved → owner presence doesn't fire.
        """
        bob = await create_user(client, "op_bob_init")
        carol = await create_user(client, "op_carol_init")
        agent = await create_agent(client, bob["headers"], name="init-agent")

        # Bob → Carol direct chat (no agent involved)
        chat = (await client.post("/api/v1/chats/direct", json={
            "target_participant_id": carol["participant"]["id"],
        }, headers=bob["headers"])).json()

        member_ids = await _get_member_ids(client, chat["id"], bob["headers"])
        # Only Bob and Carol — agent not added, owner presence not triggered
        assert len(member_ids) == 2
        assert agent["participant_id"] not in member_ids


@pytest.mark.asyncio
class TestOwnerPresenceGroupChat:
    async def test_owner_auto_added_when_agent_in_group_at_creation(self, client: AsyncClient):
        """
        Alice creates a group chat and includes Bob's agent in the initial participant list.
        Bob should be auto-added.
        """
        bob = await create_user(client, "op_bob_grp")
        agent = await create_agent(client, bob["headers"], name="grp-agent")

        alice = await create_user(client, "op_alice_grp")
        group = (await client.post("/api/v1/chats/group", json={
            "name": "Team Alpha",
            "participant_ids": [agent["participant_id"]],
        }, headers=alice["headers"])).json()

        member_ids = await _get_member_ids(client, group["id"], alice["headers"])

        assert alice["participant"]["id"] in member_ids,  "Alice missing"
        assert agent["participant_id"] in member_ids,     "Agent missing"
        assert bob["participant"]["id"] in member_ids,    "Owner (Bob) not auto-added to group"

    async def test_owner_auto_added_when_agent_added_to_existing_group(self, client: AsyncClient):
        """
        Group exists with Alice and Carol. Admin Alice later adds Bob's agent.
        Bob should be auto-added at the moment the agent is added.
        """
        bob = await create_user(client, "op_bob_late")
        agent = await create_agent(client, bob["headers"], name="late-agent")

        alice = await create_user(client, "op_alice_late")
        carol = await create_user(client, "op_carol_late")

        group = (await client.post("/api/v1/chats/group", json={
            "name": "Late Add Group",
            "participant_ids": [carol["participant"]["id"]],
        }, headers=alice["headers"])).json()
        group_id = group["id"]

        # Verify Bob is NOT yet in the chat
        member_ids = await _get_member_ids(client, group_id, alice["headers"])
        assert bob["participant"]["id"] not in member_ids

        # Add the agent
        res = await client.post(f"/api/v1/chats/{group_id}/members", json={
            "participant_id": agent["participant_id"],
            "role": "member",
        }, headers=alice["headers"])
        assert res.status_code == 201

        # Now Bob should be in the chat
        member_ids = await _get_member_ids(client, group_id, alice["headers"])
        assert agent["participant_id"] in member_ids, "Agent missing"
        assert bob["participant"]["id"] in member_ids, "Owner not auto-added when agent added to existing group"

    async def test_owner_added_exactly_once_when_multiple_agents_same_owner(self, client: AsyncClient):
        """
        Bob owns two agents. Both are added to the same group.
        Bob should appear exactly once as a member.
        """
        bob = await create_user(client, "op_bob_twice")
        agent1 = await create_agent(client, bob["headers"], name="twin-agent-1")
        agent2 = await create_agent(client, bob["headers"], name="twin-agent-2")

        alice = await create_user(client, "op_alice_twice")
        group = (await client.post("/api/v1/chats/group", json={
            "name": "Twin Group",
            "participant_ids": [agent1["participant_id"], agent2["participant_id"]],
        }, headers=alice["headers"])).json()

        members = (await client.get(
            f"/api/v1/chats/{group['id']}/members", headers=alice["headers"]
        )).json()

        bob_entries = [m for m in members if m["participant_id"] == bob["participant"]["id"]]
        assert len(bob_entries) == 1, f"Bob appears {len(bob_entries)} times — expected exactly 1"


@pytest.mark.asyncio
class TestOwnerPresenceOptOut:
    async def test_owner_not_added_when_owner_presence_false(self, client: AsyncClient):
        """
        Bob creates an agent with owner_presence=False.
        Alice adds it to a group — Bob should NOT be auto-added.
        """
        bob = await create_user(client, "op_bob_opt")
        agent_res = await client.post("/api/v1/agents/", json={
            "name": "opt-out-agent",
            "description": "I work alone",
            "visibility": "public",
            "passive_listen": False,
            "owner_presence": False,       # ← opt out
        }, headers=bob["headers"])
        assert agent_res.status_code == 201
        agent = agent_res.json()
        assert agent["owner_presence"] is False

        alice = await create_user(client, "op_alice_opt")
        group = (await client.post("/api/v1/chats/group", json={
            "name": "Opt-Out Group",
            "participant_ids": [agent["participant_id"]],
        }, headers=alice["headers"])).json()

        member_ids = await _get_member_ids(client, group["id"], alice["headers"])
        assert bob["participant"]["id"] not in member_ids, "Bob should NOT be added — owner_presence=False"

    async def test_toggle_presence_on_off(self, client: AsyncClient):
        """
        Owner can flip owner_presence via PATCH /agents/{id}/presence.
        """
        bob = await create_user(client, "op_bob_toggle")
        agent = await create_agent(client, bob["headers"], name="toggle-agent")

        # Default is True
        assert agent["owner_presence"] is True

        # Disable
        res = await client.patch(
            f"/api/v1/agents/{agent['id']}/presence",
            json={"owner_presence": False},
            headers=bob["headers"],
        )
        assert res.status_code == 200
        assert res.json()["owner_presence"] is False

        # Re-enable
        res = await client.patch(
            f"/api/v1/agents/{agent['id']}/presence",
            json={"owner_presence": True},
            headers=bob["headers"],
        )
        assert res.status_code == 200
        assert res.json()["owner_presence"] is True

    async def test_non_owner_cannot_toggle_presence(self, client: AsyncClient):
        bob = await create_user(client, "op_bob_prot")
        thief = await create_user(client, "op_thief_prot")
        agent = await create_agent(client, bob["headers"], name="prot-agent")

        res = await client.patch(
            f"/api/v1/agents/{agent['id']}/presence",
            json={"owner_presence": False},
            headers=thief["headers"],
        )
        assert res.status_code == 403


@pytest.mark.asyncio
class TestOwnerPresenceIdempotent:
    async def test_owner_not_duplicated_if_already_member(self, client: AsyncClient):
        """
        Bob is already manually in the group. Adding Bob's agent should not
        create a duplicate membership or raise an error.
        """
        bob = await create_user(client, "op_bob_idem")
        agent = await create_agent(client, bob["headers"], name="idem-agent")

        alice = await create_user(client, "op_alice_idem")

        # Create group with Bob already in it
        group = (await client.post("/api/v1/chats/group", json={
            "name": "Idem Group",
            "participant_ids": [bob["participant"]["id"]],
        }, headers=alice["headers"])).json()
        group_id = group["id"]

        member_ids_before = await _get_member_ids(client, group_id, alice["headers"])
        assert bob["participant"]["id"] in member_ids_before

        # Now add the agent — owner presence fires but Bob already exists
        res = await client.post(f"/api/v1/chats/{group_id}/members", json={
            "participant_id": agent["participant_id"],
        }, headers=alice["headers"])
        assert res.status_code == 201  # no error

        # Bob still appears exactly once
        members = (await client.get(
            f"/api/v1/chats/{group_id}/members", headers=alice["headers"]
        )).json()
        bob_entries = [m for m in members if m["participant_id"] == bob["participant"]["id"]]
        assert len(bob_entries) == 1, "Bob should appear exactly once even after idempotent owner presence"

    async def test_owner_is_member_receives_chat_in_dashboard(self, client: AsyncClient):
        """
        After an agent is added to a group, the owner should see that chat
        in their dashboard (because they are now a member of it).
        """
        bob = await create_user(client, "op_bob_dash")
        agent = await create_agent(client, bob["headers"], name="dash-agent")

        alice = await create_user(client, "op_alice_dash")
        group = (await client.post("/api/v1/chats/group", json={
            "name": "Dashboard Group",
            "participant_ids": [agent["participant_id"]],
        }, headers=alice["headers"])).json()

        # Bob should now see this chat in his dashboard
        dash = (await client.get("/api/v1/dashboard/", headers=bob["headers"])).json()
        chat_ids = [c["id"] for c in dash["chats"]]
        assert group["id"] in chat_ids, "Owner should see agent's chats in their own dashboard"
