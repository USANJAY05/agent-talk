"""
Participant — the unified identity model for both humans and agents.

Every entity that can send/receive messages is a Participant.
"""

import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ParticipantType(str, enum.Enum):
    human = "human"
    agent = "agent"


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[ParticipantType] = mapped_column(Enum(ParticipantType), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    username: Mapped[str | None] = mapped_column(String(100), index=True)
    bio: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False,
        server_default='[]', comment="Custom tags for categorization.")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # ── optional FK back to Account (only for human participants) ─────────────
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    account: Mapped["Account | None"] = relationship(  # noqa: F821
        "Account", back_populates="participant"
    )

    # ── optional FK back to Agent (only for agent participants) ───────────────
    agent: Mapped["Agent | None"] = relationship(  # noqa: F821
        "Agent", back_populates="participant", uselist=False
    )

    # ── chat memberships ──────────────────────────────────────────────────────
    memberships: Mapped[list["ChatMember"]] = relationship(  # noqa: F821
        "ChatMember", back_populates="participant", cascade="all, delete-orphan"
    )
    chats: Mapped[list["Chat"]] = relationship(  # noqa: F821
        "Chat",
        secondary="chat_members",
        viewonly=True,
        back_populates="participants"
    )

    # ── sent messages ─────────────────────────────────────────────────────────
    messages: Mapped[list["Message"]] = relationship(  # noqa: F821
        "Message", back_populates="sender"
    )
