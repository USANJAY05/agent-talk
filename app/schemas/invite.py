"""
Schemas for the Agent Invite Link + Connection Request flow.

Flow:
  Owner  → POST /agents/{id}/invites           → AgentInviteOut  (shareable link)
  Anyone → GET  /agents/invite/{code}          → AgentInvitePreview (public agent card)
  Anyone → POST /agents/invite/{code}/request  → ConnectionRequestOut (pending)
  Owner  → GET  /agents/{id}/requests          → list[ConnectionRequestOut]
  Owner  → POST /agents/{id}/requests/{rid}/approve → ApproveResult (contains token)
  Owner  → POST /agents/{id}/requests/{rid}/reject  → ConnectionRequestOut
"""

from datetime import datetime
from uuid import UUID
from typing import Optional

from pydantic import BaseModel, Field

from app.models.agent import ConnectionRequestStatus


# ── Invite creation ───────────────────────────────────────────────────────────

class AgentInviteCreate(BaseModel):
    label: Optional[str] = Field(None, description="Friendly name for this invite, e.g. 'prod deployment'")
    max_uses: Optional[int] = Field(None, ge=1, description="Max number of requests allowed. Null = unlimited.")
    expires_in_hours: Optional[int] = Field(
        None, ge=1, le=8760,
        description="How many hours until the link expires. Null = never expires."
    )


class AgentInviteOut(BaseModel):
    id: UUID
    agent_id: UUID
    invite_code: str
    invite_url: str                     # fully-qualified URL for sharing
    label: Optional[str]
    max_uses: Optional[int]
    use_count: int
    is_active: bool
    expires_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Public agent preview (shown when visiting the invite link) ────────────────

class AgentInvitePreview(BaseModel):
    """What an external party sees when they open the invite link."""
    agent_id: UUID
    agent_name: str
    agent_description: Optional[str]
    owner_username: str
    invite_code: str
    invite_label: Optional[str]
    is_valid: bool                      # False if expired, revoked, or maxed out
    invalid_reason: Optional[str]       # populated when is_valid=False


# ── Connection request ────────────────────────────────────────────────────────

class ConnectionRequestCreate(BaseModel):
    requester_name: str = Field(..., min_length=1, max_length=100,
        description="Name of the connecting system or entity.")
    requester_username: Optional[str] = Field(None, max_length=100,
        description="Username/handle for the agent.")
    requester_description: Optional[str] = Field(None, max_length=500,
        description="What this agent/system does (role/bio).")
    requester_contact: Optional[str] = Field(None, max_length=255,
        description="Contact info — email, URL, Slack handle, etc.")


class ConnectionRequestOut(BaseModel):
    id: UUID
    agent_id: UUID
    invite_id: UUID
    requester_name: str
    requester_username: Optional[str]
    requester_description: Optional[str]
    requester_contact: Optional[str]
    status: ConnectionRequestStatus
    rejection_reason: Optional[str]
    created_at: datetime
    reviewed_at: Optional[datetime]
    # Only populated after approval — the caller uses this to connect
    connection_token: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Owner review actions ──────────────────────────────────────────────────────

class RejectRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=500, description="Optional reason shown to requester.")


class ApproveResult(BaseModel):
    request_id: UUID
    status: ConnectionRequestStatus
    connection_token: str
    token_expires_at: datetime
    message: str = "Request approved. Use connection_token to authenticate with /ws/agent/connect."


# ── Invite revocation ─────────────────────────────────────────────────────────

class RevokeInviteResult(BaseModel):
    id: UUID
    is_active: bool
    message: str = "Invite link revoked."
