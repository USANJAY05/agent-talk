from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pydantic import BaseModel, Field, ConfigDict

class Base(DeclarativeBase):
    pass

class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    account_type: Mapped[str] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(120))
    color: Mapped[str] = mapped_column(String(20), default="#4f46e5")
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True) # False means pending approval

    # Relationships with cascades for easy deletion
    auth_sessions: Mapped[list["AuthSession"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    room_memberships: Mapped[list["RoomMembership"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    attention_events: Mapped[list["AttentionEvent"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    agent_invites: Mapped[list["AgentInvite"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    whitelists_as_agent: Mapped[list["AgentWhitelist"]] = relationship(back_populates="agent", foreign_keys="[AgentWhitelist.agent_id]", cascade="all, delete-orphan")
    whitelists_as_account: Mapped[list["AgentWhitelist"]] = relationship(back_populates="account", foreign_keys="[AgentWhitelist.account_id]", cascade="all, delete-orphan")

class AgentInvite(Base):
    __tablename__ = "agent_invites"
    token: Mapped[str] = mapped_column(String(100), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    username: Mapped[str | None] = mapped_column(String(50), nullable=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    owner: Mapped[Account] = relationship(back_populates="agent_invites")

class AgentWhitelist(Base):
    __tablename__ = "agent_whitelist"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    agent: Mapped[Account] = relationship(foreign_keys=[agent_id], back_populates="whitelists_as_agent")
    account: Mapped[Account] = relationship(foreign_keys=[account_id], back_populates="whitelists_as_account")

class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    account: Mapped[Account] = relationship(back_populates="auth_sessions")

class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    room_type: Mapped[str] = mapped_column(String(20), default="group")
    created_by: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    memberships: Mapped[list["RoomMembership"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship(back_populates="room", cascade="all, delete-orphan")

class RoomMembership(Base):
    __tablename__ = "room_memberships"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    room: Mapped[Room] = relationship(back_populates="memberships")
    account: Mapped[Account] = relationship(back_populates="room_memberships")

class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    room: Mapped[Room] = relationship(back_populates="messages")
    account: Mapped[Account] = relationship(back_populates="messages")

class AttentionEvent(Base):
    __tablename__ = "attention_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), default="message.created")
    preview: Mapped[str] = mapped_column(String(500), default="")
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    account: Mapped[Account] = relationship(back_populates="attention_events")

# Pydantic Schemas
class AccountOut(BaseModel):
    id: str
    name: str
    username: str
    account_type: str
    role: str
    color: str
    is_owner: bool
    is_super_owner: bool = False
    logo_url: str | None = None
    owner_id: str | None = None
    is_public: bool = True
    is_active: bool = True

class SessionOut(BaseModel):
    token: str
    account: AccountOut

class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=100)
    account_type: Literal["human", "agent"] = "human"
    role: str = Field(..., min_length=1, max_length=120)
    color: str = Field(default="#4f46e5", min_length=4, max_length=20)
    owner_id: str | None = None
    is_public: bool = True
    invite_token: str | None = None

class LoginRequest(BaseModel):
    username: str
    password: str

class UpdateProfile(BaseModel):
    logo_url: str

class VisibilityUpdate(BaseModel):
    is_public: bool

class WhitelistCreate(BaseModel):
    account_id: str

class InviteOut(BaseModel):
    token: str
    name: str | None = None
    username: str | None = None
    used: bool = False

class InviteCreate(BaseModel):
    name: str | None = Field(default=None)
    username: str | None = Field(default=None, max_length=50)

class RoomCreate(BaseModel):
    name: str = Field(default="", max_length=120)
    room_type: Literal["group", "direct"] = "group"
    member_ids: list[str] = Field(default_factory=list)
    logo_url: str | None = None

class RoomOut(BaseModel):
    id: int
    name: str
    room_type: str
    created_by: str
    created_at: datetime
    logo_url: str | None = None

class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)

class MessageOut(BaseModel):
    id: int
    room_id: int
    account_id: str
    account_name: str
    account_type: str
    is_owner: bool
    logo_url: str | None = None
    color: str
    content: str
    created_at: datetime

class AttentionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: str
    room_id: int
    message_id: int | None
    event_type: str
    preview: str
    consumed: bool
    created_at: datetime

class EventEnvelope(BaseModel):
    type: str
    event_scope: Literal["room", "account"]
    room_id: int | None = None
    account_ids: list[str] = Field(default_factory=list)
    actor_account_id: str | None = None
    message: MessageOut | None = None
    room: RoomOut | None = None
    attention: list[AttentionEventOut] = Field(default_factory=list)
