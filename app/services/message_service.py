"""Business logic for messages and mention detection."""

import re
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import Chat, ChatMember, Message, MessageType
from app.models.participant import Participant
from app.schemas.chat import MessageCreate, MessagePage


_MENTION_RE = re.compile(r"@([\w\-]+)")


async def save_message(
    db: AsyncSession,
    chat_id: UUID,
    sender_id: UUID,
    data: MessageCreate,
) -> Message:
    await _assert_chat_active(db, chat_id)

    msg = Message(
        chat_id=chat_id,
        sender_id=sender_id,
        content=data.content,
        type=data.type,
        attachment_url=data.attachment_url,
    )
    db.add(msg)

    # bump chat.updated_at so dashboards sort correctly
    chat = await db.get(Chat, chat_id)
    if chat:
        from datetime import datetime, timezone
        from app.models.chat import ChatType
        chat.updated_at = datetime.now(timezone.utc)
        
        # For direct chats, a new message should "unhide" the conversation for everyone
        if chat.type == ChatType.direct:
            from app.models.chat import ChatMember
            from sqlalchemy import update
            await db.execute(
                update(ChatMember)
                .where(ChatMember.chat_id == chat_id)
                .values(deleted_at=None)
            )

    await db.commit()
    await db.refresh(msg)
    return msg


async def get_message(db: AsyncSession, message_id: UUID) -> Message | None:
    return await db.get(Message, message_id)


async def list_messages(
    db: AsyncSession,
    chat_id: UUID,
    page: int = 1,
    page_size: int = 50,
    sort_desc: bool = False,
) -> MessagePage:
    offset = (page - 1) * page_size
    total_result = await db.scalar(
        select(func.count()).where(Message.chat_id == chat_id)
    )
    total = total_result or 0
    items_result = await db.scalars(
        select(Message)
        .where(Message.chat_id == chat_id)
        .order_by(Message.created_at.desc() if sort_desc else Message.created_at.asc())
        .offset(offset)
        .limit(page_size)
    )
    return MessagePage(
        items=list(items_result.all()),
        total=total,
        page=page,
        page_size=page_size,
    )


async def resolve_mentions(db: AsyncSession, content: str) -> list[Participant]:
    """
    Parse @name mentions from message content and resolve them to Participants
    who are in the database. Returns list of matched participants.
    """
    names = _MENTION_RE.findall(content)
    if not names:
        return []
    result = await db.scalars(
        select(Participant).where(Participant.name.in_(names))
    )
    return list(result.all())


async def get_chat_participant_ids(db: AsyncSession, chat_id: UUID) -> list[UUID]:
    """Return all participant_ids who are members of the given chat."""
    result = await db.scalars(
        select(ChatMember.participant_id).where(ChatMember.chat_id == chat_id)
    )
    return list(result.all())


async def _assert_chat_active(db: AsyncSession, chat_id: UUID) -> None:
    """Block new messages if the chat contains a deleted agent or participant."""
    from app.core.exceptions import ForbiddenError
    from app.models.agent import Agent
    from app.models.participant import ParticipantType
    
    members = await db.scalars(
        select(Participant)
        .join(ChatMember, ChatMember.participant_id == Participant.id)
        .where(ChatMember.chat_id == chat_id)
    )
    
    for p in members:
        if p.type == ParticipantType.agent:
            agent_exists = await db.scalar(select(Agent.id).where(Agent.participant_id == p.id))
            if not agent_exists:
                raise ForbiddenError("This conversation is read-only because it contains a deleted agent.")

        if p.type == ParticipantType.human:
            from app.models.account import Account
            account_exists = await db.scalar(select(Account.id).where(Account.id == p.account_id))
            if not account_exists:
                raise ForbiddenError("This conversation is read-only because it contains a deleted user.")

async def delete_message(db: AsyncSession, message_id: UUID, participant_id: UUID) -> bool:
    """Permanently delete a single message if owned by the participant."""
    msg = await db.get(Message, message_id)
    if not msg:
        return False
        
    if msg.sender_id != participant_id:
        from app.core.exceptions import ForbiddenError
        raise ForbiddenError("You can only delete your own messages.")
        
    await db.delete(msg)
    await db.commit()
    return True

async def edit_message(db: AsyncSession, message_id: UUID, participant_id: UUID, new_content: str) -> Message | None:
    """Edit a single message if owned by the participant."""
    msg = await db.get(Message, message_id)
    if not msg:
        return None
        
    if msg.sender_id != participant_id:
        from app.core.exceptions import ForbiddenError
        raise ForbiddenError("You can only edit your own messages.")
        
    msg.content = new_content
    
    # bump chat.updated_at
    chat = await db.get(Chat, msg.chat_id)
    if chat:
        from datetime import datetime, timezone
        chat.updated_at = datetime.now(timezone.utc)
        
    await db.commit()
    await db.refresh(msg)
    return msg
