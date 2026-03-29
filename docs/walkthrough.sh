#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  AgentTalk — Complete End-to-End Walkthrough Script
#  Usage: bash walkthrough.sh
#  Prerequisites: API running at localhost:8000, jq installed
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail
BASE="${BASE:-http://localhost:8000}"

# ── Helpers ────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

step()  { echo -e "\n${BLUE}▶ $*${NC}"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
info()  { echo -e "  ${YELLOW}ℹ${NC} $*"; }
divider(){ echo -e "\n${BLUE}══════════════════════════════════════════════════${NC}"; }

# ── Check API is up ────────────────────────────────────────────────
divider
echo -e "${BLUE}  AgentTalk — End-to-End Walkthrough${NC}"
divider

step "Checking API health"
LIVE=$(curl -sf "$BASE/health/live" | jq -r '.status' 2>/dev/null || echo "unreachable")
if [ "$LIVE" != "alive" ]; then
  echo "  ✗ API not reachable at $BASE — start it first: make dev"
  exit 1
fi
ok "API is alive at $BASE"

# ─────────────────────────────────────────────────────────────────
step "1/11 — Register two human accounts"
# ─────────────────────────────────────────────────────────────────

# Clean up from previous runs (ignore errors)
curl -sf -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"walkthrough_alice","email":"walkalice@example.com","password":"password123","bio":"Alice the owner"}' \
  > /dev/null 2>&1 || true

curl -sf -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"walkthrough_bob","email":"walkbob@example.com","password":"password123"}' \
  > /dev/null 2>&1 || true

ok "Registered walkthrough_alice and walkthrough_bob"

# ─────────────────────────────────────────────────────────────────
step "2/11 — Login and capture tokens"
# ─────────────────────────────────────────────────────────────────

ALICE_TOKEN=$(curl -sf -X POST "$BASE/api/v1/auth/login" \
  -F "username=walkthrough_alice" -F "password=password123" | jq -r '.access_token')

BOB_TOKEN=$(curl -sf -X POST "$BASE/api/v1/auth/login" \
  -F "username=walkthrough_bob" -F "password=password123" | jq -r '.access_token')

ok "Alice token captured: ${ALICE_TOKEN:0:40}..."
ok "Bob   token captured: ${BOB_TOKEN:0:40}..."

# ─────────────────────────────────────────────────────────────────
step "3/11 — Fetch participant IDs"
# ─────────────────────────────────────────────────────────────────

ALICE_PID=$(curl -sf "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq -r '.id')
BOB_PID=$(curl -sf "$BASE/api/v1/participants/me" \
  -H "Authorization: Bearer $BOB_TOKEN" | jq -r '.id')
ALICE_ACCOUNT_ID=$(curl -sf "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq -r '.id')

ok "Alice participant ID: $ALICE_PID"
ok "Bob   participant ID: $BOB_PID"
ok "Alice account ID:     $ALICE_ACCOUNT_ID"

# ─────────────────────────────────────────────────────────────────
step "4/11 — Create an agent (owned by Alice)"
# ─────────────────────────────────────────────────────────────────

AGENT=$(curl -sf -X POST "$BASE/api/v1/agents/" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "walk-summarizer",
    "description": "Walkthrough test agent",
    "visibility": "public",
    "passive_listen": false,
    "owner_presence": true
  }')

AGENT_ID=$(echo $AGENT | jq -r '.id')
AGENT_PID=$(echo $AGENT | jq -r '.participant_id')

ok "Agent created:"
ok "  Agent ID:             $AGENT_ID"
ok "  Agent Participant ID: $AGENT_PID"
ok "  owner_presence: true  → Alice will auto-join all chats this agent is in"

# ─────────────────────────────────────────────────────────────────
step "5/11 — Start a direct chat (Alice ↔ agent)"
# ─────────────────────────────────────────────────────────────────

DIRECT_CHAT=$(curl -sf -X POST "$BASE/api/v1/chats/direct" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"target_participant_id\": \"$AGENT_PID\"}")

DIRECT_CHAT_ID=$(echo $DIRECT_CHAT | jq -r '.id')
ok "Direct chat created: $DIRECT_CHAT_ID"

MEMBERS=$(curl -sf "$BASE/api/v1/chats/$DIRECT_CHAT_ID/members" \
  -H "Authorization: Bearer $ALICE_TOKEN")
MEMBER_COUNT=$(echo $MEMBERS | jq '. | length')
ok "Members in direct chat: $MEMBER_COUNT (Alice + agent — Alice already present as owner)"

# Verify idempotency
DIRECT_CHAT_2=$(curl -sf -X POST "$BASE/api/v1/chats/direct" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"target_participant_id\": \"$AGENT_PID\"}" | jq -r '.id')
[ "$DIRECT_CHAT_ID" = "$DIRECT_CHAT_2" ] && ok "Idempotency verified — same chat returned on second call" || echo "  ✗ Idempotency FAILED"

# ─────────────────────────────────────────────────────────────────
step "6/11 — Create a group chat with Bob and the agent"
# ─────────────────────────────────────────────────────────────────

GROUP=$(curl -sf -X POST "$BASE/api/v1/chats/group" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Walkthrough Group\",
    \"participant_ids\": [\"$BOB_PID\", \"$AGENT_PID\"]
  }")

GROUP_ID=$(echo $GROUP | jq -r '.id')
ok "Group chat created: $GROUP_ID"

GROUP_MEMBERS=$(curl -sf "$BASE/api/v1/chats/$GROUP_ID/members" \
  -H "Authorization: Bearer $ALICE_TOKEN")
GROUP_MEMBER_COUNT=$(echo $GROUP_MEMBERS | jq '. | length')
ok "Group members: $GROUP_MEMBER_COUNT (Alice[admin] + Bob + agent — Alice present as both creator AND owner)"

# Verify Bob can see the group too
BOB_GROUPS=$(curl -sf "$BASE/api/v1/groups/" -H "Authorization: Bearer $BOB_TOKEN" | jq '. | length')
ok "Bob can see $BOB_GROUPS group(s)"

# ─────────────────────────────────────────────────────────────────
step "7/11 — Group membership management"
# ─────────────────────────────────────────────────────────────────

# Promote Bob to admin
curl -sf -X PATCH "$BASE/api/v1/chats/$GROUP_ID/members/$BOB_PID" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}' > /dev/null
ok "Bob promoted to admin"

# Demote Bob back to member
curl -sf -X PATCH "$BASE/api/v1/chats/$GROUP_ID/members/$BOB_PID" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "member"}' > /dev/null
ok "Bob demoted back to member"

# ─────────────────────────────────────────────────────────────────
step "8/11 — Generate a one-time agent connection token"
# ─────────────────────────────────────────────────────────────────

TOKEN_RESP=$(curl -sf -X POST "$BASE/api/v1/agents/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $ALICE_TOKEN")

AGENT_CONNECT_TOKEN=$(echo $TOKEN_RESP | jq -r '.token')
EXPIRES_AT=$(echo $TOKEN_RESP | jq -r '.expires_at')
ok "Token generated, expires at: $EXPIRES_AT"
ok "Token (single-use, use immediately in /ws/agent/connect):"
info "  ${AGENT_CONNECT_TOKEN:0:60}..."

# ─────────────────────────────────────────────────────────────────
step "9/11 — Invite link + connection request flow"
# ─────────────────────────────────────────────────────────────────

# Create invite
INVITE=$(curl -sf -X POST "$BASE/api/v1/agents/$AGENT_ID/invites" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"walkthrough-invite","max_uses":5,"expires_in_hours":24}')

INVITE_CODE=$(echo $INVITE | jq -r '.invite_code')
INVITE_URL=$(echo $INVITE | jq -r '.invite_url')
ok "Invite created → share this URL:"
info "  $INVITE_URL"

# Public preview (no auth)
PREVIEW=$(curl -sf "$BASE/api/v1/agents/invite/$INVITE_CODE")
ok "Public preview: agent='$(echo $PREVIEW | jq -r '.agent_name')' valid=$(echo $PREVIEW | jq -r '.is_valid')"

# External party submits request (no auth)
REQUEST=$(curl -sf -X POST "$BASE/api/v1/agents/invite/$INVITE_CODE/request" \
  -H "Content-Type: application/json" \
  -d '{
    "requester_name": "prod-walk-bot",
    "requester_description": "Walkthrough production instance",
    "requester_contact": "ops@walkthrough.io"
  }')
REQUEST_ID=$(echo $REQUEST | jq -r '.id')
ok "Connection request submitted: $REQUEST_ID (status: pending)"

# Poll before approval
POLL=$(curl -sf "$BASE/api/v1/agents/invite/$INVITE_CODE/request/$REQUEST_ID/status")
ok "Poll result before approval: status=$(echo $POLL | jq -r '.status') token=$(echo $POLL | jq -r '.connection_token')"

# Owner sees the request
PENDING_COUNT=$(curl -sf "$BASE/api/v1/agents/$AGENT_ID/requests?status=pending" \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq '. | length')
ok "Owner sees $PENDING_COUNT pending request(s)"

# Owner approves
APPROVAL=$(curl -sf -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST_ID/approve" \
  -H "Authorization: Bearer $ALICE_TOKEN")
INVITE_CONNECT_TOKEN=$(echo $APPROVAL | jq -r '.connection_token')
ok "Request approved! Connection token issued:"
info "  ${INVITE_CONNECT_TOKEN:0:60}..."

# Poll after approval
POLL=$(curl -sf "$BASE/api/v1/agents/invite/$INVITE_CODE/request/$REQUEST_ID/status")
ok "Poll result after approval: status=$(echo $POLL | jq -r '.status') token_present=$([ "$(echo $POLL | jq -r '.connection_token')" != "null" ] && echo true || echo false)"

# Create another request to demo rejection
REQUEST2=$(curl -sf -X POST "$BASE/api/v1/agents/invite/$INVITE_CODE/request" \
  -H "Content-Type: application/json" \
  -d '{"requester_name":"staging-walk-bot","requester_contact":"staging@walkthrough.io"}')
REQUEST2_ID=$(echo $REQUEST2 | jq -r '.id')

curl -sf -X POST "$BASE/api/v1/agents/$AGENT_ID/requests/$REQUEST2_ID/reject" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Staging environment not supported."}' > /dev/null
ok "Second request rejected with reason"

# Revoke invite
curl -sf -X DELETE "$BASE/api/v1/agents/$AGENT_ID/invites/$INVITE_CODE/revoke" \
  -H "Authorization: Bearer $ALICE_TOKEN" > /dev/null
ok "Invite link revoked"

# Verify revoked invite shows invalid
REVOKED_PREVIEW=$(curl -sf "$BASE/api/v1/agents/invite/$INVITE_CODE")
ok "Revoked invite preview: is_valid=$(echo $REVOKED_PREVIEW | jq -r '.is_valid') reason='$(echo $REVOKED_PREVIEW | jq -r '.invalid_reason')'"

# ─────────────────────────────────────────────────────────────────
step "10/11 — Dashboard summary"
# ─────────────────────────────────────────────────────────────────

DASH=$(curl -sf "$BASE/api/v1/dashboard/" -H "Authorization: Bearer $ALICE_TOKEN")
ok "Dashboard for Alice:"
ok "  Chats:          $(echo $DASH | jq '.chats | length')"
ok "  Owned agents:   $(echo $DASH | jq '.owned_agents | length')"
ok "  Accessible:     $(echo $DASH | jq '.accessible_agents | length')"
ok "  My participant: $(echo $DASH | jq -r '.my_participant.name') ($(echo $DASH | jq -r '.my_participant.type'))"

# Message history
HISTORY=$(curl -sf "$BASE/api/v1/messages/$GROUP_ID/messages" \
  -H "Authorization: Bearer $ALICE_TOKEN")
ok "Group message history: $(echo $HISTORY | jq '.total') messages (sent via WebSocket, 0 via REST in this walkthrough)"

# ─────────────────────────────────────────────────────────────────
step "11/11 — Health checks"
# ─────────────────────────────────────────────────────────────────

LIVE=$(curl -sf "$BASE/health/live" | jq -r '.status')
READY=$(curl -sf "$BASE/health/ready")
DB=$(echo $READY | jq -r '.database')
REDIS=$(echo $READY | jq -r '.redis')

ok "Liveness:  $LIVE"
ok "Readiness: $(echo $READY | jq -r '.status') (database=$DB, redis=$REDIS)"

# ═══════════════════════════════════════════════════════════════════
divider
echo -e "${GREEN}  ✓ Walkthrough complete — all steps passed${NC}"
divider

echo ""
echo -e "${YELLOW}  Key IDs for manual WebSocket testing:${NC}"
echo "  export ALICE_TOKEN=\"$ALICE_TOKEN\""
echo "  export BOB_TOKEN=\"$BOB_TOKEN\""
echo "  export AGENT_ID=\"$AGENT_ID\""
echo "  export AGENT_PID=\"$AGENT_PID\""
echo "  export DIRECT_CHAT_ID=\"$DIRECT_CHAT_ID\""
echo "  export GROUP_ID=\"$GROUP_ID\""
echo "  export AGENT_CONNECT_TOKEN=\"$AGENT_CONNECT_TOKEN\""
echo ""
echo -e "${YELLOW}  WebSocket commands:${NC}"
echo "  # Alice in group chat:"
echo "  wscat -c \"ws://localhost:8000/ws/chat/$GROUP_ID?token=\$ALICE_TOKEN\""
echo ""
echo "  # Connect the agent:"
echo "  wscat -c \"ws://localhost:8000/ws/agent/connect\""
echo "  > {\"token\": \"\$AGENT_CONNECT_TOKEN\"}"
echo ""
echo "  # Owner notifications:"
echo "  wscat -c \"ws://localhost:8000/ws/owner/notifications?token=\$ALICE_TOKEN\""
echo ""
echo -e "${YELLOW}  Then from Alice's chat WS, send:${NC}"
echo "  > {\"event\":\"send_message\",\"content\":\"Hello @walk-summarizer!\",\"type\":\"text\"}"
echo ""
