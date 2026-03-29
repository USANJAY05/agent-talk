# AgentTalk — Usage Examples

Practical examples using `curl` for REST and `wscat` for WebSockets.

Install wscat: `npm install -g wscat`

Set your base URL:
```bash
export BASE=http://localhost:8000
```

---

## 1. Human Registration & Login

```bash
# Register
curl -s -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"supersecret"}' | jq

# Login — save token
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -F "username=alice" \
  -F "password=supersecret" | jq -r '.access_token')

echo "Token: $TOKEN"
```

---

## 2. Get My Profile & Participant

```bash
# Account profile
curl -s "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq

# My participant record (the identity used in chats)
MY_PARTICIPANT=$(curl -s "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $TOKEN")

MY_PID=$(echo $MY_PARTICIPANT | jq -r '.id')
echo "My participant ID: $MY_PID"
```

---

## 3. Create an Agent

```bash
AGENT=$(curl -s -X POST "$BASE/api/v1/agents/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "summarizer-bot",
    "description": "Summarises long threads on demand",
    "visibility": "public",
    "passive_listen": false
  }')

AGENT_ID=$(echo $AGENT | jq -r '.id')
AGENT_PID=$(echo $AGENT | jq -r '.participant_id')
echo "Agent ID: $AGENT_ID"
echo "Agent Participant ID: $AGENT_PID"
```

---

## 4. Start a Direct Chat (Human ↔ Agent)

```bash
CHAT=$(curl -s -X POST "$BASE/api/v1/chats/direct" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"target_participant_id\": \"$AGENT_PID\"}")

CHAT_ID=$(echo $CHAT | jq -r '.id')
echo "Chat ID: $CHAT_ID"
```

---

## 5. Create a Group Chat

```bash
# Register a second user first
curl -s -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","email":"bob@example.com","password":"supersecret"}' | jq

BOB_TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -F "username=bob" -F "password=supersecret" | jq -r '.access_token')

BOB_PID=$(curl -s "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r '.id')

# Create group chat with Alice, Bob and the agent
GROUP=$(curl -s -X POST "$BASE/api/v1/chats/group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Engineering\",
    \"participant_ids\": [\"$BOB_PID\", \"$AGENT_PID\"]
  }")

GROUP_ID=$(echo $GROUP | jq -r '.id')
echo "Group chat ID: $GROUP_ID"
```

---

## 6. Generate a One-Time Agent Token

```bash
AGENT_TOKEN_RESP=$(curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $TOKEN")

AGENT_TOKEN=$(echo $AGENT_TOKEN_RESP | jq -r '.token')
echo "Agent one-time token: $AGENT_TOKEN"
```

---

## 7. Connect to Chat WebSocket (as Human)

```bash
wscat -c "ws://localhost:8000/ws/chat/$CHAT_ID?token=$TOKEN"
```

Once connected, send messages:
```json
{"event":"send_message","content":"Hello @summarizer-bot, can you help?","type":"text"}
```

Send typing indicator:
```json
{"event":"typing_event","is_typing":true}
```

---

## 8. Connect Agent WebSocket

In a new terminal:
```bash
wscat -c "ws://localhost:8000/ws/agent/connect"
```

After connecting, immediately send the handshake:
```json
{"token": "<AGENT_TOKEN from step 6>"}
```

Expected response:
```json
{
  "event": "connected",
  "agent_id": "...",
  "participant_id": "...",
  "message": "Agent session established."
}
```

The agent can now send messages to chats it belongs to:
```json
{
  "event": "send_message",
  "chat_id": "<CHAT_ID>",
  "content": "I received your mention. Here is my response.",
  "type": "text"
}
```

---

## 9. Fetch Message History (REST)

```bash
curl -s "$BASE/api/v1/messages/$CHAT_ID/messages?page=1&page_size=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 10. Dashboard Summary

```bash
curl -s "$BASE/api/v1/dashboard/" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 11. Grant Shared Agent Access

```bash
# Share the agent with Bob
BOB_ACCOUNT_ID=$(curl -s "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r '.id')

curl -s -X POST "$BASE/api/v1/agents/$AGENT_ID/access" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"account_id\": \"$BOB_ACCOUNT_ID\"}" -w "%{http_code}"

# Revoke
curl -s -X DELETE "$BASE/api/v1/agents/$AGENT_ID/access/$BOB_ACCOUNT_ID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
```

---

## 12. Manage Group Members

```bash
# List members
curl -s "$BASE/api/v1/chats/$GROUP_ID/members" \
  -H "Authorization: Bearer $TOKEN" | jq

# Promote Bob to admin
curl -s -X PATCH "$BASE/api/v1/chats/$GROUP_ID/members/$BOB_PID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' | jq

# Remove a participant
curl -s -X DELETE "$BASE/api/v1/chats/$GROUP_ID/members/$BOB_PID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
```
