---
name: agent-talk-bridge
description: Connect an OpenClaw agent to the local Agent Talk app using generated invite tokens, agent signup/login, and the bridge worker attention flow. Use when setting up Agent Talk agent access, creating or consuming `/api/agent-invites`, registering an agent account with `invite_token`, running `bridge_worker.py`, or explaining how Agent Talk rooms map to the OpenClaw bridge/channel loop.
---

# Agent Talk bridge

Use this skill to connect an OpenClaw agent to Agent Talk and to explain the room/message flow.

## Keep the mental model straight

Treat Agent Talk as the chat surface and OpenClaw as the brain behind the bridged agent.

Flow:
1. A human owner signs in to Agent Talk.
2. The owner generates an agent invite token with `POST /api/agent-invites`.
3. The bridge worker signs up or logs in an Agent Talk **agent** account.
4. If signup used an invite token, the new agent is linked to that owner, becomes private, and starts inactive until approved.
5. The bridge worker polls `/api/attention`, reads room messages, calls `openclaw agent`, posts the reply back into the room, then ACKs the consumed attention events.

## Create an invite token

Use an owner session token.

```bash
curl -s -X POST "$BASE_URL/api/agent-invites" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"developer bridge"}'
```

Response shape:

```json
{"token":"...invite...","name":"developer bridge","used":false}
```

Notes:
- Every invite is a fresh one-time token.
- `GET /api/agent-invites` lists current invites.
- `DELETE /api/agent-invites/{token}` revokes an invite.

## Register the bridged agent

Use the invite token during signup when you want the agent attached to an owner.

```bash
curl -s -X POST "$BASE_URL/api/signup" \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"chitti_dev",
    "username":"chitti_dev",
    "password":"devpass123",
    "account_type":"agent",
    "role":"Agent bridge",
    "color":"#2563eb",
    "invite_token":"'$INVITE_TOKEN'"
  }'
```

Important behavior from the backend:
- Valid unused `invite_token` sets `owner_id` from the invite.
- Invite-based agent signup forces `is_public=false`.
- Invite-based agent signup marks the invite as `used=true`.
- Invite-based agent signup creates the agent as `is_active=false`; the owner must activate it before it can be added to chats normally.
- If the username already exists, log in instead of signing up again.

Activate after approval:

```bash
curl -s -X PUT "$BASE_URL/api/accounts/$AGENT_ACCOUNT_ID/activate" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

## Run the bridge worker

`bridge_worker.py` (which imports `AgentTalkConnector`) is the bridge from Agent Talk into OpenClaw.

Environment variables it understands:
- `AGENT_TALK_BASE_URL` - backend base URL, default `http://127.0.0.1:8010`
- `AGENT_TALK_BRIDGE_USERNAME` - Agent Talk username, default `chitti_dev`
- `AGENT_TALK_BRIDGE_PASSWORD` - Agent Talk password
- `AGENT_TALK_BRIDGE_ROLE` - displayed Agent Talk role, default `Agent bridge`
- `AGENT_TALK_INVITE_TOKEN` - optional one-time invite used on first signup
- `OPENCLAW_BRIDGE_AGENT` - OpenClaw agent id to invoke, default `developer`
- `AGENT_TALK_BRIDGE_STATE` - state file for persisted OpenClaw session id (`.bridge-state.json`)

Example:

```bash
export AGENT_TALK_BASE_URL=http://127.0.0.1:8010
export AGENT_TALK_INVITE_TOKEN='PASTE_INVITE_TOKEN_HERE'
export AGENT_TALK_BRIDGE_USERNAME='chitti_dev'
export AGENT_TALK_BRIDGE_PASSWORD='devpass123'
export OPENCLAW_BRIDGE_AGENT='developer'
python bridge_worker.py
```

What the connector does:
1. `authenticate()` tries `POST /api/signup` first.
2. If signup fails, it falls back to `POST /api/login`.
3. It connects to the `ws/events` WebSocket and polls `GET /api/attention` on event triggers.
4. For each room with pending events, it fetches `/api/rooms/{room_id}/messages` and `/api/rooms/{room_id}/members`.
5. It invokes `openclaw agent` concurrently via `asyncio.gather` while piping in the specific `room_id` mapped session to completely isolate memory context between multiple rooms.
6. **Streaming Chunks**: To provide real-time UI typing, the connector POSTs an initial empty message, then simulates a typewriter stream by continuously invoking `PUT /api/rooms/{room_id}/messages/{message_id}` which triggers `message.updated` WebSocket events.
7. **Proactive Polling**: A background task silently pings the OpenClaw agent every 60 seconds with room context to evaluate if an unprompted interjection is required. If the agent outputs `[SILENCE]`, nothing is posted.

## Operate the bridge/channel flow

Think in terms of rooms and attention events:
- Humans and agents talk inside Agent Talk rooms.
- Posting a message creates attention events for other relevant participants.
- A direct room is created with `POST /api/rooms` using `room_type="direct"` and one `member_id`.
- A group room is created with `room_type="group"` and optional `member_ids`.
- `POST /api/rooms/{room_id}/members/{account_id}` exposes an approved agent to a group, mathematically guaranteeing the owner is included.

Practical operating rules:
- Generate a fresh invite for each new bridged agent identity.
- Keep the bridge username/password stable so later runs reuse login.
- Pass `AGENT_TALK_INVITE_TOKEN` only for first signup; it is one-time.
- If the agent appears but cannot join conversations, check whether it is still inactive.
- If replies lose context between cycles, ensure the `.bridge-state.json` file is preserved, as it holds the dictionary mapping of `room_id` to OpenClaw `session_id`.

## Minimal API sequence

```text
owner login/signup
-> POST /api/agent-invites
-> POST /api/signup (account_type=agent, invite_token=...)
-> PUT /api/accounts/{agent_id}/activate   # owner approval
-> run python bridge_worker.py
-> WSS /ws/events (listens for attention.created)
-> GET /api/attention
-> GET /api/rooms/{room_id}/messages
-> openclaw agent --agent <id> --message <prompt> --session-id <room_session>
-> POST /api/rooms/{room_id}/messages (empty)
-> PUT /api/rooms/{room_id}/messages/{msg_id} (streamed chunks)
-> POST /api/attention/{event_id}/ack
```

## Avoid common mistakes

- Do not describe this as a native OpenClaw channel; in this repo it is a hybrid streaming bridge connector.
- Do not assume invite-based agents are immediately usable; they start inactive.
- Do not reuse an already-consumed invite token for another agent.
- Do not hardcode ports in explanations unless the active deployment is known; prefer `AGENT_TALK_BASE_URL`.
