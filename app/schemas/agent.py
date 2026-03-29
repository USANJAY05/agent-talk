"""Agent schemas."""

from uuid import UUID
from datetime import datetime

from pydantic import BaseModel

from app.models.agent import AgentVisibility


class AgentCreate(BaseModel):
    name: str
    description: str | None = None
    is_automation: bool = False
    visibility: AgentVisibility = AgentVisibility.private
    passive_listen: bool = False
    owner_presence: bool = True
    allowed_account_ids: list[UUID] = []


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    visibility: AgentVisibility | None = None
    passive_listen: bool | None = None
    owner_presence: bool | None = None


class AgentOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    visibility: AgentVisibility
    passive_listen: bool
    owner_presence: bool
    owner_id: UUID
    participant_id: UUID
    is_active: bool
    is_placeholder: bool = False
    is_automation: bool = False
    agent_username: str | None = None
    invite_code: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentTokenOut(BaseModel):
    name: str
    token: str
    pairing_code: str
    note: str = "Use token + pairing code in your external agent runtime setup. Token stays valid until revoked."


class AgentTokenCreate(BaseModel):
    name: str


class AgentAccessGrant(BaseModel):
    account_id: UUID
