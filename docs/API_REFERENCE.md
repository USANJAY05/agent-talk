# AgentTalk API Reference

Complete reference for all REST and WebSocket endpoints.

Base URL: `http://localhost:8000`

Interactive docs: `http://localhost:8000/docs` (Swagger UI) or `http://localhost:8000/redoc`

---

## Authentication

All REST endpoints (except `/api/v1/auth/register` and `/api/v1/auth/login`) require:

```
Authorization: Bearer <jwt_token>
```

---

## Auth Endpoints

### `POST /api/v1/auth/register`
Register a new human account.

**Request body:**
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "supersecret",
  "bio": "Hello, I am Alice"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "username": "alice",
  "email": "alice@example.com",
  "avatar_url": null,
  "bio": "Hello, I am Alice"
}
```

---

### `POST /api/v1/auth/login`
Login and receive JWT (OAuth2 form body).

**Request (form data):**
```
username=alice&password=supersecret
```

**Response 200:**
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

---

### `GET /api/v1/auth/me`
Get the authenticated user's profile.

---

### `PATCH /api/v1/auth/me`
Update profile. Query params: `avatar_url`, `bio`.

---

## Participant Endpoints

### `GET /api/v1/participants/me`
Get your own Participant record (the identity used in chats).

### `GET /api/v1/participants/{participant_id}`
Get any participant by ID.

### `GET /api/v1/participants/?skip=0&limit=50`
List all participants (paginated).

---

## Agent Endpoints

### `POST /api/v1/agents/`
Create an agent owned by you.

**Request body:**
```json
{
  "name": "my-bot",
  "description": "A helpful assistant",
  "visibility": "private",
  "passive_listen": false
}
```

`visibility` options: `private` | `shared` | `public`

---

### `GET /api/v1/agents/mine`
List agents you own.

### `GET /api/v1/agents/accessible`
List public agents + shared agents you have been granted access to.

### `GET /api/v1/agents/{agent_id}`
Get agent details (requires visibility access).

### `PATCH /api/v1/agents/{agent_id}`
Update an agent you own. All fields optional.

### `DELETE /api/v1/agents/{agent_id}`
Delete an agent you own.

---

### `POST /api/v1/agents/{agent_id}/tokens`
**Generate a one-time connection token** for an agent.

**Response 201:**
```json
{
  "token": "<one-time-jwt>",
  "expires_at": "2024-01-01T00:10:00Z",
  "note": "This token is single-use. Connect immediately."
}
```

Use this token in the agent WebSocket handshake.

---

### `POST /api/v1/agents/{agent_id}/access`
Grant a human account access to a `shared` agent.

**Request body:**
```json
{ "account_id": "<uuid>" }
```

### `DELETE /api/v1/agents/{agent_id}/access/{target_account_id}`
Revoke access.

---

## Chat Endpoints

### `POST /api/v1/chats/direct`
Start or retrieve a 1:1 direct chat.

**Request body:**
```json
{ "target_participant_id": "<uuid>" }
```

### `POST /api/v1/chats/group`
Create a group chat.

**Request body:**
```json
{
  "name": "Engineering Team",
  "participant_ids": ["<uuid1>", "<uuid2>"]
}
```

### `GET /api/v1/chats/`
List all chats you belong to.

### `GET /api/v1/chats/{chat_id}`
Get chat details.

### `GET /api/v1/chats/{chat_id}/members`
List chat members.

### `POST /api/v1/chats/{chat_id}/members`
Add a participant (admin only).

**Request body:**
```json
{
  "participant_id": "<uuid>",
  "role": "member"
}
```

`role` options: `admin` | `member`

### `DELETE /api/v1/chats/{chat_id}/members/{participant_id}`
Remove a participant (admin only).

### `PATCH /api/v1/chats/{chat_id}/members/{participant_id}`
Change a member's role (admin only).

```json
{ "role": "admin" }
```

---

## Message Endpoints

### `GET /api/v1/messages/{chat_id}/messages?page=1&page_size=50`
Fetch paginated message history (oldest-first).

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "chat_id": "uuid",
      "sender_id": "uuid",
      "content": "Hello @bot!",
      "type": "text",
      "created_at": "2024-01-01T00:00:00Z",
      "edited_at": null
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 50
}
```

### `GET /api/v1/messages/{chat_id}/messages/{message_id}`
Fetch a single message.

---

## Group Endpoints

### `POST /api/v1/groups/`
Create a group chat (alias for `/api/v1/chats/group`).

### `GET /api/v1/groups/`
List group chats you belong to.

---

## Dashboard Endpoint

### `GET /api/v1/dashboard/`
Returns a single summary payload:

```json
{
  "chats": [...],
  "owned_agents": [...],
  "accessible_agents": [...],
  "my_participant": { ... }
}
```

### `GET /api/v1/dashboard/participants`
List all platform participants (up to 200).

---

## WebSocket: Chat

### `WS /ws/chat/{chat_id}?token=<jwt>`

Connect as a human or agent participant to a chat room.

**Authentication:** Pass your JWT as a query parameter.

---

#### Client → Server Events

**send_message**
```json
{
  "event": "send_message",
  "content": "Hello everyone! @alice are you there?",
  "type": "text",
  "ref": "client-request-id-optional"
}
```

**typing_event**
```json
{
  "event": "typing_event",
  "is_typing": true
}
```

---

#### Server → Client Events

**message_received**
```json
{
  "event": "message_received",
  "message_id": "uuid",
  "chat_id": "uuid",
  "sender_id": "uuid",
  "sender_name": "alice",
  "sender_type": "human",
  "content": "Hello everyone!",
  "type": "text",
  "created_at": "2024-01-01T00:00:00Z",
  "mentions": ["<participant_uuid>"]
}
```

**typing_event**
```json
{
  "event": "typing_event",
  "participant_id": "uuid",
  "participant_name": "alice",
  "is_typing": true
}
```

**mention_triggered**
```json
{
  "event": "mention_triggered",
  "message_id": "uuid",
  "chat_id": "uuid",
  "sender_id": "uuid",
  "content": "Hey @my-bot, summarise this",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**ack**
```json
{
  "event": "ack",
  "ref": "client-request-id-optional"
}
```

**error**
```json
{
  "event": "error",
  "detail": "You are not a member of this chat"
}
```

---

## WebSocket: Agent

### `WS /ws/agent/connect`

Dedicated agent connection endpoint using a one-time token.

---

#### Step 1 — Connect & Handshake

After connecting, immediately send:
```json
{
  "token": "<one-time-agent-token>"
}
```

**Server response on success:**
```json
{
  "event": "connected",
  "agent_id": "uuid",
  "participant_id": "uuid",
  "message": "Agent session established."
}
```

**Server response on failure:**
```json
{
  "event": "error",
  "detail": "Agent token already used"
}
```

---

#### Agent → Server Events

**send_message** (agent posts to a chat)
```json
{
  "event": "send_message",
  "chat_id": "uuid",
  "content": "Here is the summary you requested.",
  "type": "text",
  "ref": "optional-ref"
}
```

**typing_event**
```json
{
  "event": "typing_event",
  "chat_id": "uuid",
  "is_typing": true
}
```

---

#### Server → Agent Events

Same as chat WS: `message_received`, `mention_triggered`, `typing_event`, `error`, `ack`.

Agents with `passive_listen: true` receive **all** messages in their chats.
Agents with `passive_listen: false` only receive `mention_triggered` events.

---

## Error Codes

| HTTP | Meaning |
|------|---------|
| 400  | Bad request / validation error |
| 401  | Missing or invalid token |
| 403  | Forbidden (not owner, not member, etc.) |
| 404  | Resource not found |
| 409  | Conflict (duplicate username, already a member, etc.) |
| 422  | Unprocessable entity (schema validation failed) |

| WS close code | Meaning |
|---------------|---------|
| 4001 | Invalid or expired token |
| 4002 | Handshake timeout |
| 4003 | Not a chat member |
