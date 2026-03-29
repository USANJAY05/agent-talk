"""Chat, ChatMember, and Message ORM models."""

import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


# ── Enums ─────────────────────────────────────────────────────────────────────

class ChatType(str, enum.Enum):
    direct = "direct"
    group  = "group"

class ChatVisibility(str, enum.Enum):
    public  = "public"   # Searchable by anyone
    private = "private"  # Invite/Addition only


class MemberRole(str, enum.Enum):
    admin  = "admin"
    member = "member"


class MessageType(str, enum.Enum):
    text     = "text"
    image    = "image"
    video    = "video"
    audio    = "audio"
    document = "document"
    system   = "system"   # e.g. "Alice joined the group"


# ── Chat ──────────────────────────────────────────────────────────────────────

class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[ChatType] = mapped_column(Enum(ChatType), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100),
        comment="Only used for group chats.")
    description: Mapped[str | None] = mapped_column(Text,
        comment="Optional group description.")
    visibility: Mapped[ChatVisibility] = mapped_column(
        Enum(ChatVisibility), default=ChatVisibility.private, nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True),
        comment="Participant id of creator.")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False,
        server_default='[]', comment="Custom tags for categorization.")

    members: Mapped[list["ChatMember"]] = relationship(
        "ChatMember", back_populates="chat", cascade="all, delete-orphan"
    )
    participants: Mapped[list["Participant"]] = relationship(
        "Participant",
        secondary="chat_members",
        viewonly=True,
        back_populates="chats"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="chat", cascade="all, delete-orphan"
    )


# ── ChatMember ────────────────────────────────────────────────────────────────

class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (
        UniqueConstraint("chat_id", "participant_id", name="uq_chat_participant"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("participants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[MemberRole] = mapped_column(Enum(MemberRole), default=MemberRole.member, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True,
        comment="When the user last 'deleted' this conversation from their view.")
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True,
        comment="When the user last read this chat.")


    chat: Mapped["Chat"] = relationship("Chat", back_populates="members")
    participant: Mapped["Participant"] = relationship(  # noqa: F821
        "Participant", back_populates="memberships"
    )


# ── Message ───────────────────────────────────────────────────────────────────

class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("participants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[MessageType] = mapped_column(Enum(MessageType), default=MessageType.text, nullable=False)
    attachment_url: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    chat: Mapped["Chat"] = relationship("Chat", back_populates="messages")
    sender: Mapped["Participant | None"] = relationship(  # noqa: F821
        "Participant", back_populates="messages"
    )
