"""
Agent — a framework-agnostic external system that participates in chats.

Agents are owned by human accounts and connect via an agent token protocol.
"""

import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class AgentVisibility(str, enum.Enum):
    private = "private"    # only owner can use
    shared  = "shared"     # specific users can use (via AgentAccess)
    public  = "public"     # discoverable by everyone


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    agent_username: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[AgentVisibility] = mapped_column(
        Enum(AgentVisibility), default=AgentVisibility.private, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_placeholder: Mapped[bool] = mapped_column(Boolean, default=False)
    is_automation: Mapped[bool] = mapped_column(Boolean, default=False)
    passive_listen: Mapped[bool] = mapped_column(Boolean, default=False,
        comment="If True, agent receives all messages; otherwise only mentions trigger it.")
    owner_presence: Mapped[bool] = mapped_column(Boolean, default=True,
        comment=(
            "If True (default), the agent owner is automatically added as a member "
            "to every chat this agent joins — direct or group. "
            "Set False if the owner explicitly opts out of shadowing this agent."
        ))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # ── owner ─────────────────────────────────────────────────────────────────
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    owner: Mapped["Account"] = relationship("Account", back_populates="owned_agents")  # noqa: F821

    # ── linked participant ─────────────────────────────────────────────────────
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("participants.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    participant: Mapped["Participant"] = relationship(  # noqa: F821
        "Participant", back_populates="agent"
    )

    # ── access grants (shared visibility) ────────────────────────────────────
    access_grants: Mapped[list["AgentAccess"]] = relationship(  # noqa: F821
        "AgentAccess", back_populates="agent", cascade="all, delete-orphan"
    )

    # ── connection tokens ─────────────────────────────────────────────────────
    tokens: Mapped[list["AgentToken"]] = relationship(  # noqa: F821
        "AgentToken", back_populates="agent", cascade="all, delete-orphan",
        foreign_keys="AgentToken.agent_id",
    )

    # ── invite links ──────────────────────────────────────────────────────────
    invites: Mapped[list["AgentInvite"]] = relationship(  # noqa: F821
        "AgentInvite", back_populates="agent", cascade="all, delete-orphan"
    )


class AgentAccess(Base):
    """Grants a specific human account access to a 'shared' agent."""
    __tablename__ = "agent_access"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    agent: Mapped["Agent"] = relationship("Agent", back_populates="access_grants")


class AgentToken(Base):
    """A JWT nonce record for agent connection."""
    __tablename__ = "agent_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    jti: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True,
        comment="JWT ID nonce embedded in the token.")
    name: Mapped[str] = mapped_column(String(120), nullable=False,
        comment="Human-readable token label for management/identification.")
    token: Mapped[str] = mapped_column(Text, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    pairing_code: Mapped[str] = mapped_column(String(12), nullable=False,
        comment="Short pairing code user enters in external runtime setup (e.g., OpenClaw).")
    is_paired: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    agent: Mapped["Agent"] = relationship("Agent", back_populates="tokens")


class AgentInvite(Base):
    """
    A shareable invite link an agent owner generates and distributes.

    Anyone with the invite_code can view agent details and submit a
    connection request. The owner then approves or rejects.
    """
    __tablename__ = "agent_invites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invite_code: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True,
        comment="URL-safe random token embedded in the shareable link."
    )
    label: Mapped[str | None] = mapped_column(String(100),
        comment="Human-readable label for the owner to identify this invite (e.g. 'for prod deployment').")
    max_uses: Mapped[int | None] = mapped_column(
        comment="NULL means unlimited. Once use_count reaches this, link is disabled."
    )
    use_count: Mapped[int] = mapped_column(default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    agent: Mapped["Agent"] = relationship("Agent", back_populates="invites")
    requests: Mapped[list["AgentConnectionRequest"]] = relationship(
        "AgentConnectionRequest", back_populates="invite", cascade="all, delete-orphan"
    )


class ConnectionRequestStatus(str, enum.Enum):
    pending  = "pending"
    approved = "approved"
    rejected = "rejected"


class AgentConnectionRequest(Base):
    """
    A connection request submitted by an external party via an invite link.

    On approval the owner's system generates a one-time token which is
    stored here so the requester can poll for it or receive it via webhook.
    """
    __tablename__ = "agent_connection_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invite_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_invites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # ── Requester identity (self-reported by the connecting party) ────────────
    requester_name: Mapped[str] = mapped_column(String(100), nullable=False,
        comment="Display name submitted by the connecting party.")
    requester_username: Mapped[str | None] = mapped_column(String(100),
        comment="Username/handle submitted by the connecting party.")
    requester_description: Mapped[str | None] = mapped_column(Text,
        comment="Optional description of who/what is connecting (role/bio).")
    requester_contact: Mapped[str | None] = mapped_column(String(255),
        comment="Optional contact info (email, URL, etc.).")

    # ── Status ────────────────────────────────────────────────────────────────
    status: Mapped[ConnectionRequestStatus] = mapped_column(
        Enum(ConnectionRequestStatus),
        default=ConnectionRequestStatus.pending,
        nullable=False,
        index=True,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # ── Approved token (populated on approval) ────────────────────────────────
    issued_token_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_tokens.id", ondelete="SET NULL"), nullable=True,
        comment="The one-time connection token issued upon approval."
    )

    invite: Mapped["AgentInvite"] = relationship("AgentInvite", back_populates="requests")
    issued_token: Mapped["AgentToken | None"] = relationship("AgentToken", foreign_keys=[issued_token_id])
