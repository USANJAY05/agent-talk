"""Business logic for chat creation and membership management."""

from datetime import datetime, timezone
from uuid import UUID

import sqlalchemy
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models.agent import Agent
from app.models.chat import Chat, ChatMember, ChatType, MemberRole
from app.models.participant import Participant, ParticipantType
from app.schemas.chat import DirectChatCreate, GroupChatCreate


# ── Fetch helpers ─────────────────────────────────────────────────────────────

async def get_chat(db: AsyncSession, chat_id: UUID) -> Chat:
    result = await db.execute(
        select(Chat)
        .where(Chat.id == chat_id)
        .options(selectinload(Chat.participants))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise NotFoundError("Chat")
    return chat


async def clear_chat(db: AsyncSession, chat_id: UUID, participant_id: UUID) -> None:
    """Delete all messages in a chat. History is wiped for all participants."""
    # Ensure participant belongs to the chat
    await assert_member(db, chat_id, participant_id)

    from app.models.chat import Message, ChatMember
    from sqlalchemy import delete, update

    # Delete all messages
    await db.execute(delete(Message).where(Message.chat_id == chat_id))

    # Reset last_read_at for all members to 'now' so unread count remains 0
    now = datetime.now(timezone.utc)
    await db.execute(
        update(ChatMember)
        .where(ChatMember.chat_id == chat_id)
        .values(last_read_at=now)
    )

    await db.commit()



async def assert_member(db: AsyncSession, chat_id: UUID, participant_id: UUID) -> ChatMember:
    member = await db.scalar(
        select(ChatMember).where(
            and_(ChatMember.chat_id == chat_id, ChatMember.participant_id == participant_id)
        )
    )
    if not member:
        raise ForbiddenError("You are not a member of this chat")
    return member


async def assert_admin(db: AsyncSession, chat_id: UUID, participant_id: UUID) -> ChatMember:
    member = await assert_member(db, chat_id, participant_id)
    if member.role != MemberRole.admin:
        raise ForbiddenError("Admin role required")
    return member


async def _assert_target_accessible(db: AsyncSession, requester_participant_id: UUID, target_participant_id: UUID) -> None:
    from app.services.agent_service import assert_agent_accessible
    target = await db.get(Participant, target_participant_id)
    if target and target.type == ParticipantType.agent:
        agent = await db.scalar(select(Agent).where(Agent.participant_id == target.id))
        if agent:
            requester = await db.get(Participant, requester_participant_id)
            if requester and requester.account_id:
                try:
                    await assert_agent_accessible(db, agent, requester.account_id)
                except ForbiddenError:
                    raise ForbiddenError(f"You do not have permission to chat with '{agent.name}'")


# ── Create chats ──────────────────────────────────────────────────────────────

async def create_direct_chat(
    db: AsyncSession, requester_participant_id: UUID, data: DirectChatCreate
) -> Chat:
    """Create a 1:1 chat. Returns existing chat if already exists."""
    # Check if direct chat between these two already exists
    existing = await _find_direct_chat(db, requester_participant_id, data.target_participant_id)
    if existing:
        # Ensure it's not hidden for the requester
        member = await db.scalar(
            select(ChatMember).where(
                and_(ChatMember.chat_id == existing.id, ChatMember.participant_id == requester_participant_id)
            )
        )
        if member and member.deleted_at:
            member.deleted_at = None
            await db.commit()
        return await get_chat(db, existing.id)

    target = await db.get(Participant, data.target_participant_id)
    if not target:
        raise NotFoundError("Target participant")

    await _assert_target_accessible(db, requester_participant_id, data.target_participant_id)

    chat = Chat(type=ChatType.direct, created_by=requester_participant_id)
    db.add(chat)
    await db.flush()

    for pid in [requester_participant_id, data.target_participant_id]:
        db.add(ChatMember(chat_id=chat.id, participant_id=pid, role=MemberRole.admin))
    
    await db.flush()

    # Ensure agent owners are present in the chat
    for pid in [requester_participant_id, data.target_participant_id]:
        await _ensure_owner_in_chat(db, chat.id, pid)

    await db.commit()
    return await get_chat(db, chat.id)


async def create_group_chat(
    db: AsyncSession, creator_participant_id: UUID, data: GroupChatCreate
) -> Chat:
    # Creator is always an admin
    participant_ids = list({creator_participant_id} | set(data.participant_ids))
    
    await _assert_private_group_rules(db, creator_participant_id, participant_ids)

    chat = Chat(
        type=ChatType.group,
        name=data.name,
        description=data.description,
        visibility=data.visibility,
        created_by=creator_participant_id
    )
    db.add(chat)
    await db.flush()

    for pid in participant_ids:
        if pid != creator_participant_id:
            await _assert_target_accessible(db, creator_participant_id, pid)

    for pid in participant_ids:
        role = MemberRole.admin if pid == creator_participant_id else MemberRole.member
        db.add(ChatMember(chat_id=chat.id, participant_id=pid, role=role))
        
    await db.flush()

    # Ensure agent owners are present in the chat
    for pid in participant_ids:
        await _ensure_owner_in_chat(db, chat.id, pid)

    await db.commit()
    return await get_chat(db, chat.id)


async def list_public_groups(
    db: AsyncSession,
    query: str | None = None,
    skip: int = 0,
    limit: int = 50
) -> list[Chat]:
    """Search for public group chats by name or description."""
    from app.models.chat import ChatVisibility, ChatType
    from sqlalchemy import or_, select, and_

    stmt = select(Chat).where(and_(
        Chat.type == ChatType.group,
        Chat.visibility == ChatVisibility.public
    ))

    if query:
        stmt = stmt.where(or_(
            Chat.name.ilike(f"%{query}%"),
            Chat.description.ilike(f"%{query}%")
        ))

    stmt = stmt.offset(skip).limit(limit).order_by(Chat.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _assert_private_group_rules(
    db: AsyncSession, creator_pid: UUID, participant_ids: list[UUID]
) -> None:
    """
    If any agent in the list is 'private', then:
    - No other 'human' participant (except creator) is allowed.
    - Any other 'agent' must have the same owner as the private agent.
    """
    from app.models.agent import Agent, AgentVisibility
    
    # We only care about chats with 2+ people besides the creator
    if len(participant_ids) < 2:
        return

    # Check for private agents in the group
    agents_in_chat = []
    for pid in participant_ids:
        if pid == creator_pid: continue
        p = await db.get(Participant, pid)
        if p and p.type == ParticipantType.agent:
            agent = await db.scalar(select(Agent).where(Agent.participant_id == p.id))
            if agent:
                agents_in_chat.append((p, agent))

    # If any is private, enforce strict isolation
    has_private = any(a.visibility == AgentVisibility.private for p, a in agents_in_chat)
    if not has_private:
        return

    # If there's a private agent, creator must be a human (owner) 
    # and all others must be agents owned by them.
    creator = await db.get(Participant, creator_pid)
    if not creator or not creator.account_id:
        return # system or non-human creator bypass

    for pid in participant_ids:
        if pid == creator_pid: continue
        p = await db.get(Participant, pid)
        if not p: continue
        
        if p.type == ParticipantType.human:
            raise ForbiddenError("Private agents cannot be placed in groups with other humans.")
        
        # Must be an agent owned by the same person
        agent = await db.scalar(select(Agent).where(Agent.participant_id == pid))
        if not agent or agent.owner_id != creator.account_id:
             raise ForbiddenError("A private agent can only be grouped with other agents you own.")


# ── Membership ────────────────────────────────────────────────────────────────

async def add_member(
    db: AsyncSession,
    chat: Chat,
    requester_participant_id: UUID,
    target_participant_id: UUID,
    role: MemberRole = MemberRole.member,
) -> ChatMember:
    await assert_admin(db, chat.id, requester_participant_id)
    
    current_members = await list_members(db, chat.id)
    all_pids = [m.participant_id for m in current_members] + [target_participant_id]
    await _assert_private_group_rules(db, chat.created_by, all_pids)
    
    existing = await db.scalar(
        select(ChatMember).where(
            and_(ChatMember.chat_id == chat.id, ChatMember.participant_id == target_participant_id)
        )
    )
    if existing:
        raise ConflictError("Participant is already a member")

    target = await db.get(Participant, target_participant_id)
    if not target:
        raise NotFoundError("Participant")

    member = ChatMember(chat_id=chat.id, participant_id=target_participant_id, role=role)
    db.add(member)
    await db.flush()

    # If target is an agent participant, ensure the agent owner joins too
    await _ensure_owner_in_chat(db, chat.id, target_participant_id)

    await db.commit()
    await db.refresh(member)
    return member


async def remove_member(
    db: AsyncSession,
    chat: Chat,
    requester_participant_id: UUID,
    target_participant_id: UUID,
) -> None:
    await assert_admin(db, chat.id, requester_participant_id)
    member = await db.scalar(
        select(ChatMember).where(
            and_(ChatMember.chat_id == chat.id, ChatMember.participant_id == target_participant_id)
        )
    )
    if not member:
        raise NotFoundError("Chat member")
    await db.delete(member)
    await db.commit()


async def update_member_role(
    db: AsyncSession,
    chat: Chat,
    requester_participant_id: UUID,
    target_participant_id: UUID,
    new_role: MemberRole,
) -> ChatMember:
    await assert_admin(db, chat.id, requester_participant_id)
    member = await db.scalar(
        select(ChatMember).where(
            and_(ChatMember.chat_id == chat.id, ChatMember.participant_id == target_participant_id)
        )
    )
    if not member:
        raise NotFoundError("Chat member")
    member.role = new_role
    await db.commit()
    await db.refresh(member)
    return member


async def list_members(db: AsyncSession, chat_id: UUID) -> list[ChatMember]:
    result = await db.scalars(select(ChatMember).where(ChatMember.chat_id == chat_id))
    return list(result.all())


async def leave_chat(
    db: AsyncSession,
    chat_id: UUID,
    participant_id: UUID,
) -> None:
    """
    Remove yourself from a chat.
    If no human participants remain, the chat and all messages are purged.
    """
    member = await db.scalar(
        select(ChatMember).where(
            and_(ChatMember.chat_id == chat_id, ChatMember.participant_id == participant_id)
        )
    )
    if not member:
        raise NotFoundError("Chat member")

    chat = await get_chat(db, chat_id)
    if chat.type == ChatType.direct:
        # For direct chats, we just hide it (soft delete)
        member.deleted_at = datetime.now(timezone.utc)
    else:
        # For groups, we actually leave
        await db.delete(member)

    await db.flush()

    # Check if any humans remain (active or inactive)
    # If no humans inhabit the chat at all, purge it
    any_humans = await db.scalar(
        select(Participant)
        .join(ChatMember, ChatMember.participant_id == Participant.id)
        .where(ChatMember.chat_id == chat_id)
    )

    if not any_humans:
        await db.delete(chat)

    await db.commit()


async def list_chats_for_participant(db: AsyncSession, participant_id: UUID) -> list[Chat]:
    """Return all chats the participant belongs to and hasn't 'deleted' (hidden)."""
    # We load chats where the user is a member AND deleted_at is null
    # We also want to calculate unread_count per chat
    from app.models.chat import Message
    
    result = await db.execute(
        select(Chat, ChatMember.last_read_at)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(and_(
            ChatMember.participant_id == participant_id,
            ChatMember.deleted_at == None
        ))
        .options(selectinload(Chat.participants))
        .order_by(Chat.updated_at.desc())
    )
    
    chats = []
    for chat, last_read in result:
        # Count messages in this chat created after last_read
        unread_stmt = select(func.count(Message.id)).where(and_(
            Message.chat_id == chat.id,
            Message.sender_id != participant_id,   # don't count own messages as unread
            Message.created_at > (last_read or datetime.min.replace(tzinfo=timezone.utc))
        ))
        count = await db.scalar(unread_stmt) or 0
        chat.unread_count = count
        chats.append(chat)
        
    return chats


async def mark_chat_as_read(db: AsyncSession, chat_id: UUID, participant_id: UUID) -> datetime | None:
    member = await db.scalar(
        select(ChatMember).where(and_(
            ChatMember.chat_id == chat_id,
            ChatMember.participant_id == participant_id
        ))
    )
    if member:
        member.last_read_at = datetime.now(timezone.utc)
        await db.commit()
        return member.last_read_at
    return None


# ── Internal ──────────────────────────────────────────────────────────────────

async def _ensure_owner_in_chat(
    db: AsyncSession,
    chat_id: UUID,
    participant_id: UUID,
) -> None:
    """
    If *participant_id* belongs to an agent whose owner has `owner_presence=True`,
    silently add the owner's Participant to the chat (as a member) if not already present.

    Called automatically whenever any participant is added to a chat, so every
    code path (create direct, create group, add_member, WS connect) is covered.

    Idempotent — does nothing if the owner is already a member.
    """
    # Load the participant
    participant = await db.get(Participant, participant_id)
    if not participant or participant.type != ParticipantType.agent:
        return  # only agents trigger owner auto-add

    # Load the linked agent
    agent = await db.scalar(
        select(Agent).where(Agent.participant_id == participant_id)
    )
    if not agent or not agent.owner_presence:
        return  # agent opted out of owner presence

    # Find the owner's Participant record
    from app.models.account import Account
    owner_account = await db.get(Account, agent.owner_id)
    if not owner_account:
        return

    owner_participant = await db.scalar(
        select(Participant).where(Participant.account_id == owner_account.id)
    )
    if not owner_participant:
        return

    # Check if owner is already a member — idempotent
    already_member = await db.scalar(
        select(ChatMember).where(
            and_(
                ChatMember.chat_id == chat_id,
                ChatMember.participant_id == owner_participant.id,
            )
        )
    )
    if already_member:
        return

    # Add owner as a regular member (not admin — they didn't create this chat)
    db.add(ChatMember(
        chat_id=chat_id,
        participant_id=owner_participant.id,
        role=MemberRole.member,
    ))
    # Note: no commit here — caller is responsible for the transaction


async def update_chat(
    db: AsyncSession, chat_id: UUID, requester_id: UUID, data: "ChatUpdate"
) -> Chat:
    """Update group chat metadata (name, tags, visibility, etc)."""
    chat = await get_chat(db, chat_id)
    await assert_admin(db, chat_id, requester_id)
    
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(chat, field, value)
        
    await db.commit()
    await db.refresh(chat)
    return chat


async def _find_direct_chat(
    db: AsyncSession, p1: UUID, p2: UUID
) -> Chat | None:
    """Find an existing direct chat between exactly two participants (including hidden ones)."""
    # We look for a chat where both are/were members
    result = await db.execute(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(Chat.type == ChatType.direct)
        .where(ChatMember.participant_id.in_([p1, p2]))
        .group_by(Chat.id)
        .having(sqlalchemy.func.count(ChatMember.id) == 2)
    )
    return result.scalar_one_or_none()
