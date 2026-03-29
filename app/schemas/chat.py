"""Chat and Message schemas."""

from uuid import UUID
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

from app.models.chat import ChatType, MemberRole, MessageType
from app.schemas.participant import ParticipantOut


# ── Chat ──────────────────────────────────────────────────────────────────────

class DirectChatCreate(BaseModel):
    target_participant_id: UUID


from app.models.chat import ChatType, MemberRole, MessageType, ChatVisibility

class GroupChatCreate(BaseModel):
    name: str
    description: Optional[str] = None
    visibility: ChatVisibility = ChatVisibility.private
    participant_ids: List[UUID] = []
    tags: List[str] = []


class ChatUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[ChatVisibility] = None
    tags: Optional[List[str]] = None


class ChatOut(BaseModel):
    id: UUID
    type: ChatType
    name: Optional[str]
    description: Optional[str] = None
    visibility: ChatVisibility = ChatVisibility.private
    created_by: Optional[UUID]
    created_at: datetime
    updated_at: datetime
    tags: list[str] = []
    participants: list[ParticipantOut] = []
    unread_count: int = 0

    model_config = {"from_attributes": True}


# ── ChatMember ────────────────────────────────────────────────────────────────

class ChatMemberOut(BaseModel):
    id: UUID
    chat_id: UUID
    participant_id: UUID
    role: MemberRole
    joined_at: datetime

    model_config = {"from_attributes": True}


class AddMemberRequest(BaseModel):
    participant_id: UUID
    role: MemberRole = MemberRole.member


class UpdateMemberRole(BaseModel):
    role: MemberRole


# ── Message ───────────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    content: str
    type: MessageType = MessageType.text
    attachment_url: Optional[str] = None


class MessageOut(BaseModel):
    id: UUID
    chat_id: UUID
    sender_id: Optional[UUID]
    content: str
    type: MessageType
    attachment_url: Optional[str] = None
    created_at: datetime
    edited_at: Optional[datetime]

    model_config = {"from_attributes": True}


class MessagePage(BaseModel):
    items: List[MessageOut]
    total: int
    page: int
    page_size: int
