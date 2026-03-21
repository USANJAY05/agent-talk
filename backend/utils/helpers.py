from __future__ import annotations
import secrets
import hashlib
from datetime import datetime, timezone
from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.models.database import (
    Account, AccountOut, Room, RoomOut, Message, MessageOut, 
    RoomMembership, AttentionEvent, AuthSession, AgentWhitelist, AgentInvite
)

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def normalize_id(value: str) -> str:
    return "-".join(value.strip().lower().split())

def account_out(account: Account) -> AccountOut:
    return AccountOut(
        id=account.id,
        name=account.name,
        username=account.username,
        account_type=account.account_type,
        role=account.role,
        color=account.color,
        is_owner=(account.account_type == "human" or account.is_owner),
        is_super_owner=account.is_owner,
        logo_url=account.logo_url,
        owner_id=account.owner_id,
        is_public=account.is_public,
        is_active=account.is_active,
    )

def room_out(room: Room) -> RoomOut:
    return RoomOut(
        id=room.id, 
        name=room.name, 
        room_type=room.room_type, 
        created_by=room.created_by, 
        created_at=room.created_at, 
        logo_url=room.logo_url
    )

def message_out(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        room_id=message.room_id,
        account_id=message.account_id,
        account_name=message.account.name,
        account_type=message.account.account_type,
        is_owner=(message.account.account_type == "human" or message.account.is_owner),
        logo_url=message.account.logo_url,
        color=message.account.color,
        content=message.content,
        created_at=message.created_at,
    )

def owner_account(db: Session) -> Account | None:
    return db.scalar(select(Account).where(Account.is_owner.is_(True)))

def ensure_member(db: Session, room_id: int, account_id: str) -> None:
    exists = db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == account_id))
    if not exists:
        db.add(RoomMembership(room_id=room_id, account_id=account_id))
        db.flush()

def ensure_owner_in_room(db: Session, room_id: int) -> None:
    owner = owner_account(db)
    if owner:
        ensure_member(db, room_id, owner.id)

def member_ids_for_room(db: Session, room_id: int) -> list[str]:
    return list(db.scalars(select(RoomMembership.account_id).where(RoomMembership.room_id == room_id)).all())

def create_attention_events(db: Session, room_id: int, sender_id: str, message_id: int | None, preview: str, event_type: str = "message.created") -> None:
    members = db.scalars(select(RoomMembership).where(RoomMembership.room_id == room_id)).all()
    for membership in members:
        if membership.account_id == sender_id:
            continue
        db.add(
            AttentionEvent(
                account_id=membership.account_id,
                room_id=room_id,
                message_id=message_id,
                event_type=event_type,
                preview=preview[:500],
            )
        )

def get_account_for_token(db: Session, token: str) -> Account | None:
    normalized = token.strip()
    if not normalized:
        return None
    auth = db.scalar(select(AuthSession).where(AuthSession.token == normalized))
    return auth.account if auth else None

def can_access_agent(db: Session, agent: Account, current: Account) -> bool:
    # If agent is not active, only the owner or super-owner can see/manage it
    if not agent.is_active:
        return agent.owner_id == current.id or current.is_owner
        
    if agent.is_public: return True
    if agent.owner_id == current.id: return True
    if current.is_owner: return True
    if db.scalar(select(AgentWhitelist.id).where(AgentWhitelist.agent_id == agent.id, AgentWhitelist.account_id == current.id)) is not None: return True
    return False
