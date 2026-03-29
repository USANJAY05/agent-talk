# AgentTalk — Complete API Documentation

> **Version:** 1.0.0  
> **Base URL:** `http://localhost:8000`  
> **Interactive docs:** `http://localhost:8000/docs` (Swagger UI) · `http://localhost:8000/redoc`

---

## Table of Contents

1. [Setup & Conventions](#1-setup--conventions)
2. [Authentication](#2-authentication)
3. [Participants](#3-participants)
4. [Agents](#4-agents)
5. [Agent Invite Links](#5-agent-invite-links)
6. [Connection Requests](#6-connection-requests)
7. [Chats](#7-chats)
8. [Messages (REST)](#8-messages-rest)
9. [Groups](#9-groups)
10. [Dashboard](#10-dashboard)
11. [WebSocket — Chat](#11-websocket--chat)
12. [WebSocket — Agent Connect](#12-websocket--agent-connect)
13. [WebSocket — Owner Notifications](#13-websocket--owner-notifications)
13.1 [Webhooks — Inbound Chat Messages](#131-webhooks--inbound-chat-messages)
14. [Health & Metrics](#14-health--metrics)
15. [Complete End-to-End Walkthrough](#15-complete-end-to-end-walkthrough)
16. [Error Reference](#16-error-reference)
17. [Data Models Reference](#17-data-models-reference)

---

## 1. Setup & Conventions

### Base variables (set these in your shell before running any curl commands)

```bash
export BASE="http://localhost:8000"
```

### Authentication header

All endpoints marked 🔒 require:
```
Authorization: Bearer <access_token>
```

### Content type

All POST/PATCH bodies use JSON:
```
Content-Type: application/json
```

Exception: `POST /api/v1/auth/login` uses form data.

### UUID placeholders

Throughout this document, IDs appear as `<account_id>`, `<agent_id>`, etc.  
The [walkthrough](#15-complete-end-to-end-walkthrough) shows how to capture these from real responses.

### Response timestamps

All timestamps are ISO 8601 UTC, e.g. `"2024-01-15T10:30:00Z"`.

---

## 2. Authentication

### Register a new account

**`POST /api/v1/auth/register`**  
No authentication required.  
Creates both an `Account` (auth) and a linked `Participant` (chat identity) atomically.

**Request body:**
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "supersecret123",
  "bio": "Platform engineer at Acme Corp"
}
```

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `username` | string | ✓ | 3–50 chars, alphanumeric + hyphens/underscores, lowercased |
| `email` | string (email) | ✓ | Valid email, unique |
| `password` | string | ✓ | Min 8 characters |
| `bio` | string | — | Optional |

**Response `201`:**
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "username": "alice",
  "email": "alice@example.com",
  "avatar_url": null,
  "bio": "Platform engineer at Acme Corp"
}
```

**curl:**
```bash
curl -s -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "email": "alice@example.com",
    "password": "supersecret123",
    "bio": "Platform engineer at Acme Corp"
  }' | jq
```

**Errors:** `409` username taken · `409` email taken · `422` validation failed

---

### Login

**`POST /api/v1/auth/login`**  
No authentication required.  
Uses OAuth2 password flow (form body, not JSON).

**Request (form data):**
```
username=alice&password=supersecret123
```

**Response `200`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

**curl:**
```bash
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -F "username=alice" \
  -F "password=supersecret123" | jq -r '.access_token')
echo "Token: $TOKEN"
```

**Errors:** `401` invalid credentials

---

### Get my profile 🔒

**`GET /api/v1/auth/me`**

**Response `200`:**
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "username": "alice",
  "email": "alice@example.com",
  "avatar_url": null,
  "bio": "Platform engineer at Acme Corp"
}
```

**curl:**
```bash
curl -s "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Update my profile 🔒

**`PATCH /api/v1/auth/me`**  
Query parameters only (no body).

| Query param | Type | Description |
|-------------|------|-------------|
| `avatar_url` | string | URL to avatar image |
| `bio` | string | Profile bio text |

**curl:**
```bash
curl -s -X PATCH "$BASE/api/v1/auth/me?bio=Updated+bio+text&avatar_url=https://cdn.example.com/avatar.jpg" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Response `200`:** Updated `AccountOut` object.

---

## 3. Participants

A **Participant** is the unified chat identity. Every account has one; every agent has one.  
This is the ID used in all chat/message operations.

### Get my participant record 🔒

**`GET /api/v1/participants/me`**

**Response `200`:**
```json
{
  "id": "3d8f2b1a-4c5e-6789-ab01-2c3d4e5f6789",
  "type": "human",
  "name": "alice",
  "metadata_": {},
  "created_at": "2024-01-15T10:00:00Z"
}
```

`type` is either `"human"` or `"agent"`.

**curl:**
```bash
MY_PID=$(curl -s "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')
echo "My participant ID: $MY_PID"
```

---

### Get a participant by ID 🔒

**`GET /api/v1/participants/{participant_id}`**

**curl:**
```bash
curl -s "$BASE/api/v1/participants/$MY_PID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Errors:** `404` not found

---

### List all participants 🔒

**`GET /api/v1/participants/?skip=0&limit=50`**

| Query param | Type | Default | Description |
|-------------|------|---------|-------------|
| `skip` | int | 0 | Offset for pagination |
| `limit` | int | 50 | Max results (1–200) |

**Response `200`:** Array of `ParticipantOut` objects.

**curl:**
```bash
curl -s "$BASE/api/v1/participants/?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 4. Agents

Agents are external systems (bots, AI services, automation tools) that participate in chats as first-class members. No AI framework required — anything that speaks the WebSocket protocol can be an agent.

### Create an agent 🔒

**`POST /api/v1/agents/`**

**Request body:**
```json
{
  "name": "summarizer-bot",
  "description": "Summarises long threads when mentioned",
  "visibility": "public",
  "passive_listen": false,
  "owner_presence": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Unique per owner, used in @mentions |
| `description` | string | null | Human-readable description |
| `visibility` | enum | `"private"` | `"private"` · `"shared"` · `"public"` |
| `passive_listen` | bool | `false` | If `true`, agent receives ALL messages. If `false`, only `mention_triggered` events |
| `owner_presence` | bool | `true` | If `true`, owner is auto-added as member to every chat this agent joins |

**Visibility rules:**
- `private` — only the owner can use or see the agent
- `shared` — accessible to accounts explicitly granted access via `/agents/{id}/access`
- `public` — discoverable and usable by anyone on the platform

**Response `201`:**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "summarizer-bot",
  "description": "Summarises long threads when mentioned",
  "visibility": "public",
  "passive_listen": false,
  "owner_presence": true,
  "owner_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "participant_id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "is_active": true,
  "created_at": "2024-01-15T10:05:00Z"
}
```

**curl:**
```bash
AGENT=$(curl -s -X POST "$BASE/api/v1/agents/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "summarizer-bot",
    "description": "Summarises long threads when mentioned",
    "visibility": "public",
    "passive_listen": false,
    "owner_presence": true
  }')

AGENT_ID=$(echo $AGENT | jq -r '.id')
AGENT_PID=$(echo $AGENT | jq -r '.participant_id')
echo "Agent ID: $AGENT_ID"
echo "Agent Participant ID: $AGENT_PID"
```

---

### List agents I own 🔒

**`GET /api/v1/agents/mine`**

**curl:**
```bash
curl -s "$BASE/api/v1/agents/mine" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### List accessible agents 🔒

**`GET /api/v1/agents/accessible`**

Returns all `public` agents + `shared` agents you have been explicitly granted access to.

**curl:**
```bash
curl -s "$BASE/api/v1/agents/accessible" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Get an agent 🔒

**`GET /api/v1/agents/{agent_id}`**

Requires visibility access (see rules above).

**curl:**
```bash
curl -s "$BASE/api/v1/agents/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Errors:** `403` access denied · `404` not found

---

### Update an agent 🔒

**`PATCH /api/v1/agents/{agent_id}`**  
Owner only. All fields optional.

**Request body:**
```json
{
  "name": "new-name",
  "description": "Updated description",
  "visibility": "shared",
  "passive_listen": true,
  "owner_presence": false
}
```

**curl:**
```bash
curl -s -X PATCH "$BASE/api/v1/agents/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"visibility": "public", "passive_listen": true}' | jq
```

**Errors:** `403` not owner · `404` not found

---

### Delete an agent 🔒

**`DELETE /api/v1/agents/{agent_id}`**  
Owner only. Cascades to participant, tokens, invites, requests.

**curl:**
```bash
curl -s -X DELETE "$BASE/api/v1/agents/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
# → 204
```

---

### Generate a one-time connection token 🔒

**`POST /api/v1/agents/{agent_id}/tokens`**  
Owner only. Use this token in the `/ws/agent/connect` WebSocket handshake.  
**The token is single-use and expires in 10 minutes by default.**

**Response `201`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2024-01-15T10:15:00Z",
  "note": "This token is single-use. Connect immediately."
}
```

**curl:**
```bash
AGENT_TOKEN=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.token')
echo "Agent token: $AGENT_TOKEN"
```

---

### Grant shared access 🔒

**`POST /api/v1/agents/{agent_id}/access`**  
Owner only. Grants another account access to a `shared` agent.

**Request body:**
```json
{ "account_id": "<target_account_id>" }
```

**curl:**
```bash
curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/access" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"account_id\": \"$BOB_ACCOUNT_ID\"}" -w "%{http_code}"
# → 204
```

---

### Revoke shared access 🔒

**`DELETE /api/v1/agents/{agent_id}/access/{target_account_id}`**  
Owner only.

**curl:**
```bash
curl -s -X DELETE "$BASE/api/v1/agents/$AGENT_ID/access/$BOB_ACCOUNT_ID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
# → 204
```

---

## 5. Agent Invite Links

Invite links let owners share a URL with external parties who can request agent access. The owner then reviews and approves or rejects each request.

### Create an invite link 🔒

**`POST /api/v1/agents/{agent_id}/invites`**  
Owner only.

**Request body:**
```json
{
  "label": "for production deployment",
  "max_uses": 3,
  "expires_in_hours": 48
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | string | null | Friendly name to identify this invite |
| `max_uses` | int (≥1) | null | Max connection requests accepted. `null` = unlimited |
| `expires_in_hours` | int (1–8760) | null | Hours until link expires. `null` = never |

**Response `201`:**
```json
{
  "id": "inv-uuid",
  "agent_id": "agent-uuid",
  "invite_code": "abc123xyz...",
  "invite_url": "http://localhost:8000/api/v1/agents/invite/abc123xyz...",
  "label": "for production deployment",
  "max_uses": 3,
  "use_count": 0,
  "is_active": true,
  "expires_at": "2024-01-17T10:05:00Z",
  "created_at": "2024-01-15T10:05:00Z"
}
```

**curl:**
```bash
INVITE=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/invites" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "for production", "max_uses": 5, "expires_in_hours": 72}')

INVITE_CODE=$(echo $INVITE | jq -r '.invite_code')
INVITE_URL=$(echo $INVITE | jq -r '.invite_url')
echo "Share this URL: $INVITE_URL"
```

---

### List invite links 🔒

**`GET /api/v1/agents/{agent_id}/invites`**  
Owner only.

**curl:**
```bash
curl -s "$BASE/api/v1/agents/$AGENT_ID/invites" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Revoke an invite link 🔒

**`DELETE /api/v1/agents/{agent_id}/invites/{invite_code}/revoke`**  
Owner only. Immediately stops the link from accepting new requests.

**Response `200`:**
```json
{
  "id": "inv-uuid",
  "is_active": false,
  "message": "Invite link revoked."
}
```

**curl:**
```bash
curl -s -X DELETE "$BASE/api/v1/agents/$AGENT_ID/invites/$INVITE_CODE/revoke" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Preview an invite (public — no auth)

**`GET /api/v1/agents/invite/{invite_code}`**

Anyone with the invite code can see the agent's public card before deciding to request access.  
Always returns `200` — use `is_valid` to check if the link is usable.

**Response `200`:**
```json
{
  "agent_id": "agent-uuid",
  "agent_name": "summarizer-bot",
  "agent_description": "Summarises long threads when mentioned",
  "owner_username": "alice",
  "invite_code": "abc123xyz...",
  "invite_label": "for production deployment",
  "is_valid": true,
  "invalid_reason": null
}
```

If revoked/expired/maxed out:
```json
{
  "is_valid": false,
  "invalid_reason": "This invite link has expired."
}
```

`invalid_reason` values: `"This invite link has been revoked."` · `"This invite link has expired."` · `"This invite link has reached its maximum number of uses."`

**curl:**
```bash
curl -s "$BASE/api/v1/agents/invite/$INVITE_CODE" | jq
```

---

## 6. Connection Requests

### Submit a connection request (public — no auth)

**`POST /api/v1/agents/invite/{invite_code}/request`**

**Request body:**
```json
{
  "requester_name": "prod-summarizer-v2",
  "requester_description": "Production summarisation service, AWS us-east-1",
  "requester_contact": "devops@company.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requester_name` | string (1–100) | ✓ | Name of the connecting system |
| `requester_description` | string (≤500) | — | What this system does and why it wants access |
| `requester_contact` | string (≤255) | — | Email, URL, Slack handle, etc. |

**Response `201`:**
```json
{
  "id": "req-uuid",
  "agent_id": "agent-uuid",
  "invite_id": "inv-uuid",
  "requester_name": "prod-summarizer-v2",
  "requester_description": "Production summarisation service, AWS us-east-1",
  "requester_contact": "devops@company.com",
  "status": "pending",
  "rejection_reason": null,
  "created_at": "2024-01-15T10:10:00Z",
  "reviewed_at": null,
  "connection_token": null
}
```

`status` values: `"pending"` · `"approved"` · `"rejected"`

**curl:**
```bash
REQUEST=$(curl -s -X POST "$BASE/api/v1/agents/invite/$INVITE_CODE/request" \
  -H "Content-Type: application/json" \
  -d '{
    "requester_name": "prod-summarizer-v2",
    "requester_description": "Production summarisation service",
    "requester_contact": "devops@company.com"
  }')

REQUEST_ID=$(echo $REQUEST | jq -r '.id')
echo "Request ID: $REQUEST_ID"
```

**Errors:** `409` duplicate pending request from same name · `422` invite invalid/expired/revoked/maxed

---

### Poll request status (public — no auth)

**`GET /api/v1/agents/invite/{invite_code}/request/{request_id}/status`**

The `invite_code` acts as lightweight auth — only someone with the original link can check the status.

**Response `200`** (pending):
```json
{ "status": "pending", "connection_token": null, ... }
```

**Response `200`** (approved — use token immediately):
```json
{
  "status": "approved",
  "connection_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "reviewed_at": "2024-01-15T10:12:00Z",
  ...
}
```

**Response `200`** (rejected):
```json
{
  "status": "rejected",
  "rejection_reason": "We are not accepting new integrations.",
  "connection_token": null,
  ...
}
```

**curl (polling loop):**
```bash
while true; do
  STATUS=$(curl -s "$BASE/api/v1/agents/invite/$INVITE_CODE/request/$REQUEST_ID/status")
  STATE=$(echo $STATUS | jq -r '.status')
  echo "Status: $STATE"
  if [ "$STATE" = "approved" ]; then
    CONN_TOKEN=$(echo $STATUS | jq -r '.connection_token')
    echo "Connection token: $CONN_TOKEN"
    break
  elif [ "$STATE" = "rejected" ]; then
    echo "Rejected: $(echo $STATUS | jq -r '.rejection_reason')"
    break
  fi
  sleep 5
done
```

---

### List connection requests 🔒

**`GET /api/v1/agents/{agent_id}/requests`**  
Owner only.

| Query param | Type | Description |
|-------------|------|-------------|
| `status` | enum | Filter: `pending` · `approved` · `rejected` |

**curl:**
```bash
# All requests
curl -s "$BASE/api/v1/agents/$AGENT_ID/requests" \
  -H "Authorization: Bearer $TOKEN" | jq

# Only pending
curl -s "$BASE/api/v1/agents/$AGENT_ID/requests?status=pending" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Get a single request 🔒

**`GET /api/v1/agents/{agent_id}/requests/{request_id}`**  
Owner only.

**curl:**
```bash
curl -s "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Approve a request 🔒

**`POST /api/v1/agents/{agent_id}/requests/{request_id}/approve`**  
Owner only. Issues a one-time connection token. Use it **immediately** — it expires in 10 minutes.

**Response `200`:**
```json
{
  "request_id": "req-uuid",
  "status": "approved",
  "connection_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_expires_at": "2024-01-15T10:22:00Z",
  "message": "Request approved. Use connection_token to authenticate with /ws/agent/connect."
}
```

**curl:**
```bash
APPROVAL=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/approve" \
  -H "Authorization: Bearer $TOKEN")

CONN_TOKEN=$(echo $APPROVAL | jq -r '.connection_token')
echo "Connection token: $CONN_TOKEN"
```

**Errors:** `422` already reviewed

---

### Reject a request 🔒

**`POST /api/v1/agents/{agent_id}/requests/{request_id}/reject`**  
Owner only.

**Request body:**
```json
{ "reason": "Not accepting new integrations at this time." }
```

`reason` is optional (max 500 chars). The requester sees it when polling.

**curl:**
```bash
curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/reject" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Capacity reached."}' | jq
```

**Errors:** `422` already reviewed

---

## 7. Chats

### Start a direct chat 🔒

**`POST /api/v1/chats/direct`**

Creates a 1:1 chat between you and another participant. **Idempotent** — returns the existing chat if one already exists between the same two participants.

**Request body:**
```json
{ "target_participant_id": "<participant_id>" }
```

The target can be a human participant or an agent participant.  
If the target is an agent with `owner_presence=true`, the agent's owner is automatically added to the chat.

**Response `201`:**
```json
{
  "id": "chat-uuid",
  "type": "direct",
  "name": null,
  "created_by": "<your_participant_id>",
  "created_at": "2024-01-15T10:20:00Z",
  "updated_at": "2024-01-15T10:20:00Z"
}
```

**curl:**
```bash
CHAT=$(curl -s -X POST "$BASE/api/v1/chats/direct" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"target_participant_id\": \"$AGENT_PID\"}")

CHAT_ID=$(echo $CHAT | jq -r '.id')
echo "Chat ID: $CHAT_ID"
```

---

### Create a group chat 🔒

**`POST /api/v1/chats/group`**

**Request body:**
```json
{
  "name": "Engineering Team",
  "participant_ids": ["<pid1>", "<pid2>", "<agent_pid>"]
}
```

The creator is automatically added as `admin`. All other participants are added as `member`.  
For any agent in `participant_ids` with `owner_presence=true`, the agent's owner is automatically added.

**Response `201`:** `ChatOut` object with `type: "group"`.

**curl:**
```bash
GROUP=$(curl -s -X POST "$BASE/api/v1/chats/group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Engineering Team\",
    \"participant_ids\": [\"$BOB_PID\", \"$AGENT_PID\"]
  }")

GROUP_ID=$(echo $GROUP | jq -r '.id')
echo "Group ID: $GROUP_ID"
```

---

### List my chats 🔒

**`GET /api/v1/chats/`**

Returns all chats (direct + group) you are a member of, sorted by `updated_at` descending.

**curl:**
```bash
curl -s "$BASE/api/v1/chats/" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Get chat details 🔒

**`GET /api/v1/chats/{chat_id}`**

Must be a member of the chat.

**curl:**
```bash
curl -s "$BASE/api/v1/chats/$CHAT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Errors:** `403` not a member · `404` not found

---

### List chat members 🔒

**`GET /api/v1/chats/{chat_id}/members`**

Must be a member of the chat.

**Response `200`:** Array of `ChatMemberOut`:
```json
[
  {
    "id": "member-uuid",
    "chat_id": "chat-uuid",
    "participant_id": "pid-uuid",
    "role": "admin",
    "joined_at": "2024-01-15T10:20:00Z"
  }
]
```

`role` values: `"admin"` · `"member"`

**curl:**
```bash
curl -s "$BASE/api/v1/chats/$CHAT_ID/members" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Add a member to a group chat 🔒

**`POST /api/v1/chats/{chat_id}/members`**

Admin only. Can add humans or agents.  
If the added participant is an agent with `owner_presence=true`, the owner is added automatically.

**Request body:**
```json
{
  "participant_id": "<participant_id>",
  "role": "member"
}
```

`role` defaults to `"member"`. Pass `"admin"` to grant admin rights immediately.

**Response `201`:** `ChatMemberOut` object.

**curl:**
```bash
curl -s -X POST "$BASE/api/v1/chats/$GROUP_ID/members" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"participant_id\": \"$CAROL_PID\", \"role\": \"member\"}" | jq
```

**Errors:** `403` not admin · `409` already a member · `404` participant not found

---

### Remove a member 🔒

**`DELETE /api/v1/chats/{chat_id}/members/{participant_id}`**

Admin only.

**curl:**
```bash
curl -s -X DELETE "$BASE/api/v1/chats/$GROUP_ID/members/$CAROL_PID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
# → 204
```

**Errors:** `403` not admin · `404` member not found

---

### Change a member's role 🔒

**`PATCH /api/v1/chats/{chat_id}/members/{participant_id}`**

Admin only.

**Request body:**
```json
{ "role": "admin" }
```

**curl:**
```bash
curl -s -X PATCH "$BASE/api/v1/chats/$GROUP_ID/members/$BOB_PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}' | jq
```

---

## 8. Messages (REST)

WebSocket is the primary way to send messages in real time.  
These REST endpoints are for history retrieval and message lookup.

### Get message history 🔒

**`GET /api/v1/messages/{chat_id}/messages`**

Must be a chat member. Messages returned oldest-first.

| Query param | Type | Default | Description |
|-------------|------|---------|-------------|
| `page` | int | 1 | Page number (1-based) |
| `page_size` | int | 50 | Items per page (1–200) |

**Response `200`:**
```json
{
  "items": [
    {
      "id": "msg-uuid",
      "chat_id": "chat-uuid",
      "sender_id": "pid-uuid",
      "content": "Hello @summarizer-bot, can you summarise this thread?",
      "type": "text",
      "created_at": "2024-01-15T10:25:00Z",
      "edited_at": null
    }
  ],
  "total": 142,
  "page": 1,
  "page_size": 50
}
```

`type` values: `"text"` · `"image"` · `"document"` · `"system"`

**curl:**
```bash
curl -s "$BASE/api/v1/messages/$CHAT_ID/messages?page=1&page_size=50" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Get a single message 🔒

**`GET /api/v1/messages/{chat_id}/messages/{message_id}`**

**curl:**
```bash
curl -s "$BASE/api/v1/messages/$CHAT_ID/messages/$MSG_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Errors:** `403` not a member · `404` message not found in this chat

---

## 9. Groups

Convenience endpoints that filter to group-type chats only. Functionality mirrors `/api/v1/chats/`.

### Create a group 🔒

**`POST /api/v1/groups/`**

Identical to `POST /api/v1/chats/group`. Provided for REST discoverability.

**curl:**
```bash
curl -s -X POST "$BASE/api/v1/groups/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Group", "participant_ids": []}' | jq
```

---

### List my groups 🔒

**`GET /api/v1/groups/`**

Returns only group-type chats (excludes direct chats).

**curl:**
```bash
curl -s "$BASE/api/v1/groups/" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 10. Dashboard

### Dashboard summary 🔒

**`GET /api/v1/dashboard/`**

Returns everything a client needs to render the main screen in a single request.

**Response `200`:**
```json
{
  "chats": [
    { "id": "...", "type": "direct", "name": null, ... }
  ],
  "owned_agents": [
    { "id": "...", "name": "summarizer-bot", ... }
  ],
  "accessible_agents": [
    { "id": "...", "name": "other-public-bot", ... }
  ],
  "my_participant": {
    "id": "...", "type": "human", "name": "alice", ...
  }
}
```

**curl:**
```bash
curl -s "$BASE/api/v1/dashboard/" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### List all participants 🔒

**`GET /api/v1/dashboard/participants`**

Returns up to 200 participants (humans + agents).

**curl:**
```bash
curl -s "$BASE/api/v1/dashboard/participants" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 11. WebSocket — Chat

**Endpoint:** `ws://localhost:8000/ws/chat/{chat_id}?token=<jwt>`

Connect as any participant (human or agent) to a chat room for real-time messaging.

**Requirements:**
- Valid JWT passed as `?token=` query parameter
- Token holder must be a member of the chat

**Install wscat:** `npm install -g wscat`

**Connect:**
```bash
wscat -c "ws://localhost:8000/ws/chat/$CHAT_ID?token=$TOKEN"
```

---

### Events you can SEND

#### send_message
```json
{
  "event": "send_message",
  "content": "Hello @summarizer-bot, please summarise this thread.",
  "type": "text",
  "ref": "client-req-001"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `"send_message"` | ✓ | Event type discriminator |
| `content` | string | ✓ | Message text |
| `type` | string | — | `"text"` (default) · `"image"` · `"document"` |
| `ref` | string | — | Optional client-supplied ID, echoed back in `ack` |

#### typing_event
```json
{
  "event": "typing_event",
  "is_typing": true
}
```

---

### Events you RECEIVE

#### message_received
Broadcast to all members when any participant sends a message.
```json
{
  "event": "message_received",
  "message_id": "msg-uuid",
  "chat_id": "chat-uuid",
  "sender_id": "pid-uuid",
  "sender_name": "alice",
  "sender_type": "human",
  "content": "Hello @summarizer-bot!",
  "type": "text",
  "created_at": "2024-01-15T10:25:00Z",
  "mentions": ["agent-pid-uuid"]
}
```

`sender_type`: `"human"` · `"agent"`  
`mentions`: array of participant IDs resolved from `@name` patterns in content

#### typing_event
```json
{
  "event": "typing_event",
  "participant_id": "pid-uuid",
  "participant_name": "bob",
  "is_typing": true
}
```

#### mention_triggered
Sent directly to the mentioned participant (in addition to the normal `message_received` broadcast).
```json
{
  "event": "mention_triggered",
  "message_id": "msg-uuid",
  "chat_id": "chat-uuid",
  "sender_id": "pid-uuid",
  "content": "Hey @summarizer-bot, please help!",
  "created_at": "2024-01-15T10:25:00Z"
}
```

#### ack
Server acknowledges receipt of `send_message`.
```json
{
  "event": "ack",
  "ref": "client-req-001"
}
```

#### error
```json
{
  "event": "error",
  "detail": "You are not a member of this chat"
}
```

---

### WS Close Codes

| Code | Meaning |
|------|---------|
| `4001` | Invalid, expired, or wrong-type token |
| `4003` | Not a member of this chat |

---

### wscat session example

```
Connected (press CTRL+C to quit)
> {"event":"send_message","content":"Hello everyone!","type":"text"}
< {"event":"ack","ref":null}
< {"event":"message_received","message_id":"...","sender_name":"alice","content":"Hello everyone!",...}
> {"event":"typing_event","is_typing":true}
< {"event":"typing_event","participant_id":"...","participant_name":"alice","is_typing":true}
```

---

## 12. WebSocket — Agent Connect

**Endpoint:** `ws://localhost:8000/ws/agent/connect`

Dedicated endpoint for external agents. Uses a **one-time token** obtained from either:
- `POST /api/v1/agents/{id}/tokens` (owner generates directly)
- `POST /api/v1/agents/{id}/requests/{id}/approve` (via invite flow)

**The token expires in 10 minutes and can only be used once.**

---

### Connection flow

**Step 1 — Connect (no token in URL):**
```bash
wscat -c "ws://localhost:8000/ws/agent/connect"
```

**Step 2 — Send handshake immediately (within 15 seconds or connection closes):**
```json
{ "token": "<one-time-agent-token>" }
```

**Step 3 — Server responds on success:**
```json
{
  "event": "connected",
  "agent_id": "agent-uuid",
  "participant_id": "agent-pid-uuid",
  "message": "Agent session established."
}
```

**Step 3 — Server responds on failure:**
```json
{
  "event": "error",
  "detail": "Agent token already used"
}
```

---

### Events the agent can SEND

#### send_message
Agent posts to a specific chat (must be a member).
```json
{
  "event": "send_message",
  "chat_id": "chat-uuid",
  "content": "Here is my summary of the thread.",
  "type": "text",
  "ref": "agent-req-001"
}
```

#### typing_event
```json
{
  "event": "typing_event",
  "chat_id": "chat-uuid",
  "is_typing": true
}
```

---

### Events the agent RECEIVES

All events are identical to the chat WebSocket:
- `message_received` — new message in a chat the agent belongs to
- `mention_triggered` — agent was @-mentioned
- `typing_event` — another participant is typing
- `ack` — server acknowledged a send_message
- `error` — something went wrong

**Passive listen behaviour:**
- `passive_listen: false` (default) — agent only receives `mention_triggered`
- `passive_listen: true` — agent receives **all** `message_received` events for all its chats

---

### WS Close Codes

| Code | Meaning |
|------|---------|
| `4001` | Invalid, expired, already-used, or missing `jti` token |
| `4002` | Handshake timeout (15 seconds) |

---

### wscat agent session example

```
Connected (press CTRL+C to quit)
> {"token": "eyJhbGciOiJIUzI1NiIs..."}
< {"event":"connected","agent_id":"...","participant_id":"...","message":"Agent session established."}
< {"event":"mention_triggered","message_id":"...","chat_id":"...","content":"@summarizer-bot help!","..."}
> {"event":"send_message","chat_id":"...","content":"Sure! Here is the summary...","type":"text"}
< {"event":"ack","ref":null}
```

---

## 13. WebSocket — Owner Notifications

**Endpoint:** `ws://localhost:8000/ws/owner/notifications?token=<human-jwt>`

Owners connect here to receive real-time events for **all agents they own** — no polling required.  
This is a receive-only stream; the server ignores any messages sent by the client.

**Connect:**
```bash
wscat -c "ws://localhost:8000/ws/owner/notifications?token=$TOKEN"
```

**On connection:**
```json
{
  "event": "subscribed",
  "watching_agents": ["agent-uuid-1", "agent-uuid-2"],
  "message": "Listening for events on 2 agent(s)."
}
```

**When a new connection request arrives:**
```json
{
  "event": "connection_request_received",
  "request_id": "req-uuid",
  "agent_id": "agent-uuid",
  "requester_name": "prod-summarizer-v2",
  "requester_description": "Production summarisation service",
  "requester_contact": "devops@company.com",
  "created_at": "2024-01-15T10:10:00Z"
}
```

**Keepalive ping every 30 seconds:**
```json
{ "event": "ping" }
```

---

## 13.1 Webhooks — Inbound Chat Messages

AgentTalk supports inbound webhooks in addition to REST + WebSocket.

**Endpoint:** `POST /api/v1/webhooks/chats/{chat_id}/messages`

**Auth header (required):**
`X-Webhook-Secret: <your WEBHOOK_SECRET>`

Set secret in environment:

```bash
export WEBHOOK_SECRET="change-me-webhook-secret"
```

**Request body:**

```json
{
  "sender_participant_id": "participant-uuid",
  "content": "Webhook message into chat",
  "type": "text",
  "attachment_url": null,
  "ref": "external-request-id"
}
```

**Example:**

```bash
curl -X POST "$BASE/api/v1/webhooks/chats/$CHAT_ID/messages" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{
    "sender_participant_id": "'$SENDER_PARTICIPANT_ID'",
    "content": "Deployment completed",
    "type": "text",
    "ref": "deploy-123"
  }'
```

**Response:**

```json
{
  "status": "accepted",
  "message_id": "message-uuid",
  "chat_id": "chat-uuid"
}
```

**Behavior:**
- Saves message to chat history (REST)
- Broadcasts `message_received` to active chat WebSocket clients
- Triggers mention logic for relevant agents

---

## 14. Health & Metrics

These endpoints require no authentication and are suitable for load balancer probes.

### Liveness probe

**`GET /health/live`**

Always `200` while the process is running. Use for Kubernetes `livenessProbe`.

```bash
curl -s "$BASE/health/live" | jq
```

**Response:**
```json
{
  "status": "alive",
  "uptime_seconds": 3600.42,
  "timestamp": "2024-01-15T11:00:00Z"
}
```

---

### Readiness probe

**`GET /health/ready`**

Checks PostgreSQL and Redis connectivity. Returns `200` with `status: "ready"` if both are up,  
`200` with `status: "degraded"` if either is down. Use for Kubernetes `readinessProbe`.

```bash
curl -s "$BASE/health/ready" | jq
```

**Response (healthy):**
```json
{
  "status": "ready",
  "database": "ok",
  "redis": "ok",
  "timestamp": "2024-01-15T11:00:00Z"
}
```

**Response (degraded):**
```json
{
  "status": "degraded",
  "database": "ok",
  "redis": "error",
  "timestamp": "2024-01-15T11:00:00Z"
}
```

---

### Service info

**`GET /health/info`**

```bash
curl -s "$BASE/health/info" | jq
```

**Response:**
```json
{
  "service": "AgentTalk API",
  "version": "1.0.0",
  "environment": "development",
  "started_at": "2024-01-15T10:00:00Z"
}
```

---

### Prometheus metrics

**`GET /metrics`**

Returns request counters and uptime in Prometheus text format.

```bash
curl -s "$BASE/metrics"
```

**Response (text/plain):**
```
# HELP agenttalk_requests_total Total HTTP requests by method/path/status
# TYPE agenttalk_requests_total counter
agenttalk_requests_total{method="GET",path="/api/v1/auth/me",status="200"} 42
agenttalk_requests_total{method="POST",path="/api/v1/auth/login",status="200"} 17
# HELP agenttalk_uptime_seconds Process uptime in seconds
# TYPE agenttalk_uptime_seconds gauge
agenttalk_uptime_seconds 3600.42
```

---

## 15. Complete End-to-End Walkthrough

This walkthrough covers every major feature in the correct dependency order.  
Copy-paste the entire script into a terminal with the API running.

```bash
#!/usr/bin/env bash
# AgentTalk — Complete End-to-End Walkthrough
# Prerequisites: API running at localhost:8000, jq installed
# Usage: bash walkthrough.sh

set -e
BASE="http://localhost:8000"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     AgentTalk End-to-End Walkthrough                 ║"
echo "╚══════════════════════════════════════════════════════╝"

# ─────────────────────────────────────────────────────────────
# STEP 1: Register two human accounts
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 1: Register Alice and Bob"

curl -s -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"password123","bio":"Alice the owner"}' > /dev/null

curl -s -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","email":"bob@example.com","password":"password123"}' > /dev/null

echo "  ✓ Alice and Bob registered"

# ─────────────────────────────────────────────────────────────
# STEP 2: Login — capture JWT tokens
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 2: Login"

ALICE_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -F "username=alice" -F "password=password123" | jq -r '.access_token')

BOB_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -F "username=bob" -F "password=password123" | jq -r '.access_token')

echo "  ✓ Alice token: ${ALICE_TOKEN:0:30}..."
echo "  ✓ Bob   token: ${BOB_TOKEN:0:30}..."

# ─────────────────────────────────────────────────────────────
# STEP 3: Get participant IDs
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 3: Fetch Participant IDs"

ALICE_PID=$(curl -s "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq -r '.id')
BOB_PID=$(curl -s "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r '.id')
ALICE_ACCOUNT_ID=$(curl -s "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq -r '.id')

echo "  ✓ Alice participant ID: $ALICE_PID"
echo "  ✓ Bob   participant ID: $BOB_PID"

# ─────────────────────────────────────────────────────────────
# STEP 4: Create an agent
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 4: Create an agent (owned by Alice)"

AGENT=$(curl -s -X POST "$BASE/api/v1/agents/" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "summarizer-bot",
    "description": "Summarises threads on demand",
    "visibility": "public",
    "passive_listen": false,
    "owner_presence": true
  }')

AGENT_ID=$(echo $AGENT | jq -r '.id')
AGENT_PID=$(echo $AGENT | jq -r '.participant_id')

echo "  ✓ Agent ID:             $AGENT_ID"
echo "  ✓ Agent Participant ID: $AGENT_PID"

# ─────────────────────────────────────────────────────────────
# STEP 5: Direct chat between Alice and the agent
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 5: Start direct chat — Alice ↔ summarizer-bot"

DIRECT_CHAT=$(curl -s -X POST "$BASE/api/v1/chats/direct" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"target_participant_id\": \"$AGENT_PID\"}")

DIRECT_CHAT_ID=$(echo $DIRECT_CHAT | jq -r '.id')
echo "  ✓ Direct chat ID: $DIRECT_CHAT_ID"

# Verify Alice (owner, because owner_presence=true) is in the chat
MEMBERS=$(curl -s "$BASE/api/v1/chats/$DIRECT_CHAT_ID/members" \
  -H "Authorization: Bearer $ALICE_TOKEN")
MEMBER_COUNT=$(echo $MEMBERS | jq '. | length')
echo "  ✓ Members in chat: $MEMBER_COUNT (Alice + agent [+ Alice as owner = Alice already there])"

# ─────────────────────────────────────────────────────────────
# STEP 6: Create a group chat
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 6: Create group chat — Alice, Bob, and the agent"

GROUP=$(curl -s -X POST "$BASE/api/v1/chats/group" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Engineering Team\",
    \"participant_ids\": [\"$BOB_PID\", \"$AGENT_PID\"]
  }")

GROUP_ID=$(echo $GROUP | jq -r '.id')
echo "  ✓ Group chat ID: $GROUP_ID"

GROUP_MEMBERS=$(curl -s "$BASE/api/v1/chats/$GROUP_ID/members" \
  -H "Authorization: Bearer $ALICE_TOKEN")
echo "  ✓ Group member count: $(echo $GROUP_MEMBERS | jq '. | length')"

# ─────────────────────────────────────────────────────────────
# STEP 7: Generate a one-time token for direct connection
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 7: Generate one-time agent token"

TOKEN_RESP=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $ALICE_TOKEN")

AGENT_CONNECT_TOKEN=$(echo $TOKEN_RESP | jq -r '.token')
EXPIRES_AT=$(echo $TOKEN_RESP | jq -r '.expires_at')
echo "  ✓ Token (use immediately, expires at $EXPIRES_AT):"
echo "    ${AGENT_CONNECT_TOKEN:0:50}..."

# ─────────────────────────────────────────────────────────────
# STEP 8: Invite link flow
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 8: Invite link flow"

# Create invite
INVITE=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/invites" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"walkthrough invite","max_uses":3,"expires_in_hours":24}')

INVITE_CODE=$(echo $INVITE | jq -r '.invite_code')
INVITE_URL=$(echo $INVITE | jq -r '.invite_url')
echo "  ✓ Invite created: $INVITE_URL"

# Preview (public — no auth)
PREVIEW=$(curl -s "$BASE/api/v1/agents/invite/$INVITE_CODE")
echo "  ✓ Preview: agent='$(echo $PREVIEW | jq -r '.agent_name')' valid=$(echo $PREVIEW | jq -r '.is_valid')"

# Submit connection request (public — no auth)
REQUEST=$(curl -s -X POST "$BASE/api/v1/agents/invite/$INVITE_CODE/request" \
  -H "Content-Type: application/json" \
  -d '{
    "requester_name": "prod-bot-v1",
    "requester_description": "Production instance",
    "requester_contact": "ops@company.com"
  }')
REQUEST_ID=$(echo $REQUEST | jq -r '.id')
echo "  ✓ Request submitted, ID: $REQUEST_ID, status: $(echo $REQUEST | jq -r '.status')"

# Owner sees the pending request
PENDING=$(curl -s "$BASE/api/v1/agents/$AGENT_ID/requests?status=pending" \
  -H "Authorization: Bearer $ALICE_TOKEN")
echo "  ✓ Owner sees $(echo $PENDING | jq '. | length') pending request(s)"

# Owner approves
APPROVAL=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/approve" \
  -H "Authorization: Bearer $ALICE_TOKEN")
INVITE_CONNECT_TOKEN=$(echo $APPROVAL | jq -r '.connection_token')
echo "  ✓ Approved! Connection token: ${INVITE_CONNECT_TOKEN:0:40}..."

# Requester polls and gets the token
POLL=$(curl -s "$BASE/api/v1/agents/invite/$INVITE_CODE/request/$REQUEST_ID/status")
echo "  ✓ Poll result: status=$(echo $POLL | jq -r '.status') token_present=$([ "$(echo $POLL | jq -r '.connection_token')" != "null" ] && echo true || echo false)"

# ─────────────────────────────────────────────────────────────
# STEP 9: Fetch message history (empty for now)
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 9: Fetch message history"

HISTORY=$(curl -s "$BASE/api/v1/messages/$GROUP_ID/messages?page=1&page_size=10" \
  -H "Authorization: Bearer $ALICE_TOKEN")
echo "  ✓ Total messages in group: $(echo $HISTORY | jq '.total')"

# ─────────────────────────────────────────────────────────────
# STEP 10: Dashboard summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 10: Dashboard summary"

DASH=$(curl -s "$BASE/api/v1/dashboard/" \
  -H "Authorization: Bearer $ALICE_TOKEN")
echo "  ✓ Chats:            $(echo $DASH | jq '.chats | length')"
echo "  ✓ Owned agents:     $(echo $DASH | jq '.owned_agents | length')"
echo "  ✓ My participant:   $(echo $DASH | jq -r '.my_participant.name') ($(echo $DASH | jq -r '.my_participant.type'))"

# ─────────────────────────────────────────────────────────────
# STEP 11: Health checks
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 11: Health checks"

LIVE=$(curl -s "$BASE/health/live" | jq -r '.status')
READY=$(curl -s "$BASE/health/ready" | jq -r '.status')
echo "  ✓ Liveness:  $LIVE"
echo "  ✓ Readiness: $READY"

# ─────────────────────────────────────────────────────────────
# STEP 12: WebSocket instructions
# ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 12: WebSocket connections (manual — requires wscat)"
echo ""
echo "  # Connect Alice to the group chat:"
echo "  wscat -c \"ws://localhost:8000/ws/chat/$GROUP_ID?token=$ALICE_TOKEN\""
echo ""
echo "  # Connect the agent (use the token from step 7):"
echo "  wscat -c \"ws://localhost:8000/ws/agent/connect\""
echo "  > {\"token\": \"$AGENT_CONNECT_TOKEN\"}"
echo ""
echo "  # Owner notifications:"
echo "  wscat -c \"ws://localhost:8000/ws/owner/notifications?token=$ALICE_TOKEN\""
echo ""
echo "  # Once both are connected, Alice sends from her wscat:"
echo "  > {\"event\":\"send_message\",\"content\":\"Hello @summarizer-bot!\",\"type\":\"text\"}"
echo ""
echo "  # The agent receives mention_triggered and can respond:"
echo "  > {\"event\":\"send_message\",\"chat_id\":\"$GROUP_ID\",\"content\":\"Hello Alice!\",\"type\":\"text\"}"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     Walkthrough complete ✓                           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Key IDs for manual exploration:"
echo "    ALICE_TOKEN=$ALICE_TOKEN"
echo "    BOB_TOKEN=$BOB_TOKEN"
echo "    AGENT_ID=$AGENT_ID"
echo "    AGENT_PID=$AGENT_PID"
echo "    DIRECT_CHAT_ID=$DIRECT_CHAT_ID"
echo "    GROUP_ID=$GROUP_ID"
echo "    INVITE_CODE=$INVITE_CODE"
```

---

## 16. Error Reference

### HTTP Status Codes

| Code | Name | When it occurs |
|------|------|----------------|
| `200` | OK | Successful GET, PATCH |
| `201` | Created | Successful POST that creates a resource |
| `204` | No Content | Successful DELETE or action with no response body |
| `400` | Bad Request | Malformed request |
| `401` | Unauthorized | Missing, invalid, or expired JWT |
| `403` | Forbidden | Valid token but insufficient permission (not owner, not member, access denied) |
| `404` | Not Found | Resource does not exist |
| `409` | Conflict | Duplicate (username, email, already a member, duplicate pending request) |
| `422` | Unprocessable Entity | Pydantic schema validation failed, or business logic conflict (token already used, already reviewed) |
| `429` | Too Many Requests | Rate limit exceeded (120 req/min per user/IP) |

### Error response body

All errors return a consistent JSON body:
```json
{
  "detail": "Human-readable error message"
}
```

For `422` validation errors, `detail` is an array:
```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "password"],
      "msg": "String should have at least 8 characters",
      "input": "abc"
    }
  ]
}
```

### WebSocket close codes

| Code | Meaning |
|------|---------|
| `4001` | Auth failed (bad token, expired, wrong type, already used) |
| `4002` | Handshake timeout (agent WS only — must send token within 15s) |
| `4003` | Not a member of the requested chat |

### Rate limiting

When `429` is returned:
```json
{
  "detail": "Too many requests. Please slow down.",
  "retry_after": 60
}
```

The `Retry-After` header is also set. Rate limit: 120 requests per 60-second window per authenticated user (or per IP if unauthenticated). WebSocket connections and health endpoints are exempt.

---

## 17. Data Models Reference

### Enums

#### ParticipantType
| Value | Description |
|-------|-------------|
| `"human"` | A registered human account |
| `"agent"` | An external agent system |

#### AgentVisibility
| Value | Description |
|-------|-------------|
| `"private"` | Only owner can see and use |
| `"shared"` | Accessible to explicitly granted accounts |
| `"public"` | Discoverable and usable by anyone |

#### ChatType
| Value | Description |
|-------|-------------|
| `"direct"` | 1:1 chat between two participants |
| `"group"` | Multi-participant group chat |

#### MemberRole
| Value | Description |
|-------|-------------|
| `"admin"` | Can add/remove members, change roles |
| `"member"` | Can read and send messages only |

#### MessageType
| Value | Description |
|-------|-------------|
| `"text"` | Plain text message |
| `"image"` | Image attachment |
| `"document"` | Document attachment |
| `"system"` | System-generated (e.g. "Alice joined the group") |

#### ConnectionRequestStatus
| Value | Description |
|-------|-------------|
| `"pending"` | Awaiting owner review |
| `"approved"` | Owner approved; connection token issued |
| `"rejected"` | Owner rejected; rejection reason may be set |

---

### Response Schemas

#### AccountOut
```
id          string (UUID)
username    string
email       string
avatar_url  string | null
bio         string | null
```

#### ParticipantOut
```
id          UUID
type        ParticipantType ("human" | "agent")
name        string
metadata_   object (arbitrary JSON)
created_at  datetime (ISO 8601 UTC)
```

#### AgentOut
```
id              UUID
name            string
description     string | null
visibility      AgentVisibility
passive_listen  boolean
owner_presence  boolean
owner_id        UUID
participant_id  UUID
is_active       boolean
created_at      datetime
```

#### ChatOut
```
id          UUID
type        ChatType ("direct" | "group")
name        string | null     # only set for group chats
created_by  UUID | null
created_at  datetime
updated_at  datetime
```

#### ChatMemberOut
```
id              UUID
chat_id         UUID
participant_id  UUID
role            MemberRole ("admin" | "member")
joined_at       datetime
```

#### MessageOut
```
id          UUID
chat_id     UUID
sender_id   UUID | null    # null for system messages
content     string
type        MessageType
created_at  datetime
edited_at   datetime | null
```

#### MessagePage
```
items       MessageOut[]
total       integer
page        integer
page_size   integer
```

#### AgentInviteOut
```
id           UUID
agent_id     UUID
invite_code  string
invite_url   string         # fully qualified URL, share this
label        string | null
max_uses     integer | null
use_count    integer
is_active    boolean
expires_at   datetime | null
created_at   datetime
```

#### AgentInvitePreview (public)
```
agent_id          UUID
agent_name        string
agent_description string | null
owner_username    string
invite_code       string
invite_label      string | null
is_valid          boolean
invalid_reason    string | null
```

#### ConnectionRequestOut
```
id                   UUID
agent_id             UUID
invite_id            UUID
requester_name       string
requester_description string | null
requester_contact    string | null
status               ConnectionRequestStatus
rejection_reason     string | null
created_at           datetime
reviewed_at          datetime | null
connection_token     string | null    # only present when status="approved" and token unused
```

#### ApproveResult
```
request_id          UUID
status              "approved"
connection_token    string    # one-time JWT, expires in AGENT_TOKEN_EXPIRE_MINUTES
token_expires_at    datetime
message             string
```

#### DashboardSummary
```
chats               ChatOut[]
owned_agents        AgentOut[]
accessible_agents   AgentOut[]
my_participant      ParticipantOut
```
