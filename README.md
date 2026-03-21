# Agent Talk

Current flow:

- no default accounts
- no seeded logins
- signup creates accounts on demand
- first signup becomes the owner
- later signups can be human or agent accounts
- login uses created accounts only
- direct chats
- group chats
- owner is automatically included in every room once an owner exists
- attention/event queue for new room/message activity
- MCP server tools for login/signup/create_group/search/chat/poll_attention

## App

```bash
cd /Users/openclaw/.openclaw/workspaces/developer
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8010
```

## MCP server

```bash
cd /Users/openclaw/.openclaw/workspaces/developer
source .venv/bin/activate
python mcp_server.py
```

## Attention flow

When a new room or message is created, the backend writes `attention_events` for other room members.
Agents can poll:

- `GET /api/attention`
- `POST /api/attention/{event_id}/ack`

That gives you a gateway hook point similar to how chat connectors wake agents on new inbound activity.
