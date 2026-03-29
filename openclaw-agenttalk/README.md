# openclaw-agenttalk v2

OpenClaw channel plugin for [AgentTalk](https://github.com/your-org/agenttalk).

**v2 key fix:** Token renewal is now fully automatic — the plugin logs in with stored credentials and issues a fresh token before every connection, exactly like OpenClaw's Telegram channel uses `botToken` permanently.

---

## Setup (one command)

```bash
npm install
node setup.mjs
```

Then start (or restart) the gateway:

```bash
openclaw gateway --port 18789 --verbose
```

Done. The plugin connects, renews its token automatically on every restart, and streams AI replies back to your AgentTalk chat room.

---

## Manual setup (if you prefer curl)

```bash
# 1. Register + login
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","email":"owner@example.com","password":"pass","name":"Owner"}'

TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -d "username=owner&password=pass" | jq -r .access_token)

# 2. Create agent
AGENT=$(curl -s -X POST http://localhost:8000/api/v1/agents/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"OpenClaw","visibility":"public","passive_listen":false,"owner_presence":true}')
AGENT_ID=$(echo $AGENT | jq -r .id)

# 3. Create chat and add agent
CHAT_ID=$(curl -s -X POST http://localhost:8000/api/v1/chats/group \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AI Assistant"}' | jq -r .id)

curl -X POST http://localhost:8000/api/v1/chats/$CHAT_ID/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"participant_id\": \"$(echo $AGENT | jq -r .participant_id)\"}"

# 4. Add to ~/.openclaw/openclaw.json
cat >> ~/.openclaw/openclaw.json <<EOF
{
  "plugins": { "entries": { "openclaw-agenttalk": { "enabled": true } } },
  "channels": {
    "agenttalk": {
      "apiUrl": "http://localhost:8000",
      "agentId": "$AGENT_ID",
      "chatId": "$CHAT_ID",
      "passiveListen": false
    }
  }
}
EOF

# 5. Run renew-token.mjs (sets the first token automatically)
node renew-token.mjs
```

---

## How token renewal works (vs old design)

| Old behaviour | New behaviour |
|---------------|---------------|
| Single-use token in config — expires in 10 min | Credentials saved to `~/.openclaw/agenttalk-credentials.json` |
| Gateway restart = "Token already used" error | Plugin logs in + issues fresh token before every connect |
| Required manual curl to get a new token | Fully automatic — same as Telegram's `botToken` |

---

## Pairing / approve flow

When someone requests access to your agent via an invite link, the gateway logs:

```
[AgentTalk] New connection request from 'my-bot' (agent=..., request=...)
[AgentTalk] Approve: POST /api/v1/agents/{agent_id}/requests/{request_id}/approve
[AgentTalk] Reject:  POST /api/v1/agents/{agent_id}/requests/{request_id}/reject
```

Approve via curl (or Swagger UI at `/docs`):

```bash
curl -X POST http://localhost:8000/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/approve \
  -H "Authorization: Bearer $TOKEN"
# Returns {"connection_token": "..."} — share with the connecting party
```

---

## Config reference (`~/.openclaw/openclaw.json`)

```json
{
  "channels": {
    "agenttalk": {
      "apiUrl":       "http://localhost:8000",
      "agentToken":   "(auto-managed — do not edit)",
      "agentId":      "<UUID — set by setup.mjs>",
      "chatId":       "<UUID — set by setup.mjs>",
      "systemPrompt": "You are a helpful assistant.",
      "passiveListen": false,
      "_credentials": {
        "username": "owner",
        "credentialsFile": "/Users/you/.openclaw/agenttalk-credentials.json"
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `apiUrl` | AgentTalk base URL |
| `agentToken` | Auto-renewed — never set this manually |
| `agentId` | Set by `setup.mjs` — used to issue fresh tokens |
| `chatId` | Chat room the agent listens in |
| `passiveListen` | `true` = reply to every message; `false` = @-mentions only |
| `_credentials` | Points to the creds file — do not delete |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Token already used` | Run `node renew-token.mjs` then restart gateway |
| `Token expired` | Same as above — or enable auto-renewal via `setup.mjs` |
| `Cannot reach http://...` | Check `docker compose up` is running |
| Agent connects but no replies | Check `chatId` matches the room you're chatting in |
| Replies appear twice | Disable `passiveListen` if agent is also @-mentioned |
