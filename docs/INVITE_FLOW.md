# Agent Invite Link & Connection Request Flow

This document describes the complete lifecycle for connecting an external agent
via a shareable invite link, including the owner's approve/reject workflow.

---

## Overview

```
Owner                          External Agent / System              Server
  │                                      │                            │
  │  POST /agents/{id}/invites           │                            │
  │─────────────────────────────────────────────────────────────────►│
  │  ◄── {invite_url, invite_code} ──────────────────────────────────│
  │                                      │                            │
  │  (shares invite_url via any          │                            │
  │   channel — email, Slack, etc.)      │                            │
  │ ────────────────────────────────────►│                            │
  │                                      │                            │
  │                                      │  GET /agents/invite/{code} │
  │                                      │───────────────────────────►│
  │                                      │  ◄── agent preview card ───│
  │                                      │                            │
  │                                      │  POST /agents/invite/{code}/request
  │                                      │───────────────────────────►│
  │                                      │  ◄── {request_id, status:pending}
  │                                      │                            │
  │  WS event: connection_request_received              │            │
  │◄─────────────────────────────────────────────────────────────────│
  │                                      │                            │
  │  GET /agents/{id}/requests           │                            │
  │─────────────────────────────────────────────────────────────────►│
  │  ◄── [list of pending requests] ─────────────────────────────────│
  │                                      │                            │
  │  (reviews requester details,         │                            │
  │   decides to approve or reject)      │                            │
  │                                      │                            │
  │  POST /agents/{id}/requests/{rid}/approve           │            │
  │─────────────────────────────────────────────────────────────────►│
  │  ◄── {connection_token, expires_at} ─────────────────────────────│
  │                                      │                            │
  │  (sends token to agent via           │                            │
  │   any side channel)                  │                            │
  │ ────────────────────────────────────►│                            │
  │                                      │  WS /ws/agent/connect      │
  │                                      │───────────────────────────►│
  │                                      │  {"token": "..."}          │
  │                                      │───────────────────────────►│
  │                                      │  ◄── {"event":"connected"} │
```

Alternatively, the external agent can **self-poll** without the owner sharing the token:

```
External Agent
  │
  │  POST /agents/invite/{code}/request  →  {request_id}
  │
  │  (poll every N seconds)
  │  GET /agents/invite/{code}/request/{request_id}/status
  │       → status: "pending"  (keep polling)
  │       → status: "approved", connection_token: "..."  (connect now!)
  │       → status: "rejected", rejection_reason: "..."  (stop)
```

---

## API Endpoints

### Owner — Create Invite Link

**`POST /api/v1/agents/{agent_id}/invites`**

```bash
curl -X POST "$BASE/api/v1/agents/$AGENT_ID/invites" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "for prod deployment",
    "max_uses": 3,
    "expires_in_hours": 48
  }'
```

Response:
```json
{
  "id": "uuid",
  "agent_id": "uuid",
  "invite_code": "abc123...",
  "invite_url": "http://localhost:8000/api/v1/agents/invite/abc123...",
  "label": "for prod deployment",
  "max_uses": 3,
  "use_count": 0,
  "is_active": true,
  "expires_at": "2024-01-03T00:00:00Z",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Share `invite_url` with whoever should connect the agent.**

---

### External — View Agent Preview

**`GET /api/v1/agents/invite/{invite_code}`** — no auth required

```bash
curl "$BASE/api/v1/agents/invite/abc123..."
```

Response:
```json
{
  "agent_id": "uuid",
  "agent_name": "summarizer-bot",
  "agent_description": "Summarises long threads on demand",
  "owner_username": "alice",
  "invite_code": "abc123...",
  "invite_label": "for prod deployment",
  "is_valid": true,
  "invalid_reason": null
}
```

If the link has expired or been revoked:
```json
{
  "is_valid": false,
  "invalid_reason": "This invite link has expired."
}
```

---

### External — Submit Connection Request

**`POST /api/v1/agents/invite/{invite_code}/request`** — no auth required

```bash
curl -X POST "$BASE/api/v1/agents/invite/abc123.../request" \
  -H "Content-Type: application/json" \
  -d '{
    "requester_name": "prod-summarizer-v2",
    "requester_description": "Production instance of our summarisation service, deployed on AWS us-east-1",
    "requester_contact": "devops@company.com"
  }'
```

Response:
```json
{
  "id": "request-uuid",
  "agent_id": "uuid",
  "invite_id": "uuid",
  "requester_name": "prod-summarizer-v2",
  "requester_description": "Production instance...",
  "requester_contact": "devops@company.com",
  "status": "pending",
  "rejection_reason": null,
  "created_at": "2024-01-01T00:00:00Z",
  "reviewed_at": null,
  "connection_token": null
}
```

---

### External — Poll for Status

**`GET /api/v1/agents/invite/{invite_code}/request/{request_id}/status`** — no auth required

```bash
# Poll until status changes
curl "$BASE/api/v1/agents/invite/abc123.../request/$REQUEST_ID/status"
```

Pending:
```json
{ "status": "pending", "connection_token": null }
```

Approved:
```json
{
  "status": "approved",
  "connection_token": "<one-time-jwt>",
  ...
}
```

Rejected:
```json
{
  "status": "rejected",
  "rejection_reason": "This deployment slot is reserved.",
  "connection_token": null
}
```

---

### Owner — List Pending Requests

**`GET /api/v1/agents/{agent_id}/requests?status=pending`**

```bash
curl "$BASE/api/v1/agents/$AGENT_ID/requests?status=pending" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### Owner — Approve Request

**`POST /api/v1/agents/{agent_id}/requests/{request_id}/approve`**

```bash
curl -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/approve" \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "request_id": "uuid",
  "status": "approved",
  "connection_token": "<one-time-jwt>",
  "token_expires_at": "2024-01-01T00:10:00Z",
  "message": "Request approved. Use connection_token to authenticate with /ws/agent/connect."
}
```

---

### Owner — Reject Request

**`POST /api/v1/agents/{agent_id}/requests/{request_id}/reject`**

```bash
curl -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/reject" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "We are not accepting new integrations at this time."}'
```

---

### Owner — Revoke Invite Link

**`DELETE /api/v1/agents/{agent_id}/invites/{invite_code}/revoke`**

```bash
curl -X DELETE "$BASE/api/v1/agents/$AGENT_ID/invites/abc123.../revoke" \
  -H "Authorization: Bearer $TOKEN"
```

---

### Owner — Real-Time Notifications WebSocket

Connect once and receive all incoming requests live — no polling needed.

**`WS /ws/owner/notifications?token=<human-jwt>`**

```bash
wscat -c "ws://localhost:8000/ws/owner/notifications?token=$TOKEN"
```

On connection:
```json
{
  "event": "subscribed",
  "watching_agents": ["agent-uuid-1", "agent-uuid-2"],
  "message": "Listening for events on 2 agent(s)."
}
```

When a new request arrives:
```json
{
  "event": "connection_request_received",
  "request_id": "uuid",
  "agent_id": "uuid",
  "requester_name": "prod-summarizer-v2",
  "requester_description": "Production instance...",
  "requester_contact": "devops@company.com",
  "created_at": "2024-01-01T00:00:00Z"
}
```

The server sends a `{"event":"ping"}` every 30 seconds to keep the connection alive.

---

## Invite Configuration Options

| Field | Type | Description |
|-------|------|-------------|
| `label` | string (optional) | Friendly name for the invite, e.g. `"for staging env"` |
| `max_uses` | int (optional) | Maximum number of requests this link can accept. Null = unlimited |
| `expires_in_hours` | int (optional) | Hours until the link expires. Null = never expires |

---

## Security Notes

- Invite links are **public** — anyone with the code can view the agent card and submit a request. They cannot connect without owner approval.
- The `invite_code` is a cryptographically random 32-byte URL-safe token (256 bits of entropy).
- The `connection_token` returned on approval is single-use and expires within `AGENT_TOKEN_EXPIRE_MINUTES` (default 10 min).
- The poll endpoint uses `invite_code` as lightweight authorization — only someone with the original invite link can check that request's status.
- Owners can revoke invite links at any time. Revoked links stop accepting new requests immediately but do not affect already-approved connections.
