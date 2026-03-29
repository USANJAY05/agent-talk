"""
WebSocket message envelope schemas.

All WS messages are JSON with an 'event' discriminator field.

Human/Agent → Server:
  send_message   – post a message to the chat
  typing_event   – broadcast typing indicator

Server → Client:
  message_received   – new message in chat
  mention_triggered  – this participant was @-mentioned
  typing_event       – another participant is typing
  error              – something went wrong
  ack                – server acknowledges receipt
"""

from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel


# ── Inbound (client → server) ─────────────────────────────────────────────────

class WSSendMessage(BaseModel):
    event: Literal["send_message"]
    content: str
    type: str = "text"


class WSTypingEvent(BaseModel):
    event: Literal["typing_event"]
    is_typing: bool


# ── Outbound (server → client) ────────────────────────────────────────────────

class WSMessageReceived(BaseModel):
    event: Literal["message_received"] = "message_received"
    message_id: str
    chat_id: str
    sender_id: Optional[str]
    sender_name: Optional[str]
    sender_type: str           # "human" | "agent"
    content: str
    type: str
    created_at: str
    mentions: list[str] = []   # list of mentioned participant ids


class WSMentionTriggered(BaseModel):
    event: Literal["mention_triggered"] = "mention_triggered"
    message_id: str
    chat_id: str
    sender_id: str
    content: str
    created_at: str


class WSTypingBroadcast(BaseModel):
    event: Literal["typing_event"] = "typing_event"
    participant_id: str
    participant_name: str
    is_typing: bool


class WSError(BaseModel):
    event: Literal["error"] = "error"
    detail: str


class WSAck(BaseModel):
    event: Literal["ack"] = "ack"
    ref: Optional[str] = None   # echo back a client-supplied request id


# ── Agent handshake ───────────────────────────────────────────────────────────

class AgentHandshake(BaseModel):
    token: str


class AgentConnected(BaseModel):
    event: Literal["connected"] = "connected"
    agent_id: str
    participant_id: str
    message: str = "Agent session established."
