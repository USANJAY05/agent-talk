"""Message history endpoints (REST fallback; real-time via WebSocket)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.schemas.chat import MessageOut, MessagePage, MessageCreate
from app.services.chat_service import assert_member
from app.services.message_service import get_message, list_messages
from app.services.participant_service import get_participant_by_account

router = APIRouter()


@router.get("/{chat_id}/messages", response_model=MessagePage,
    summary="Fetch paginated message history for a chat")
async def get_history(
    chat_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_desc: bool = Query(True), # Default to True for newest-first (ideal for load-more)
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns messages. Use `sort_desc=True` for newest-first.
    """
    me = await get_participant_by_account(db, account)
    await assert_member(db, chat_id, me.id)
    return await list_messages(db, chat_id, page=page, page_size=page_size, sort_desc=sort_desc)


@router.get("/{chat_id}/messages/{message_id}", response_model=MessageOut,
    summary="Fetch a single message")
async def get_one(
    chat_id: UUID,
    message_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    await assert_member(db, chat_id, me.id)
    msg = await get_message(db, message_id)
    if not msg or str(msg.chat_id) != str(chat_id):
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Message")
    return msg


@router.delete("/{chat_id}/messages/{message_id}", status_code=204,
    summary="Delete a single message")
async def delete_one(
    chat_id: UUID,
    message_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    from app.services.message_service import delete_message
    from app.db.redis import chat_channel, publish
    
    me = await get_participant_by_account(db, account)
    await assert_member(db, chat_id, me.id)
    
    success = await delete_message(db, message_id, me.id)
    if success:
        # Broadcast the deletion
        await publish(chat_channel(str(chat_id)), {
            "event": "message_deleted",
            "message_id": str(message_id),
            "chat_id": str(chat_id),
        })
    else:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Message")

@router.patch("/{chat_id}/messages/{message_id}", response_model=MessageOut,
    summary="Edit a single message")
async def edit_one(
    chat_id: UUID,
    message_id: UUID,
    data: MessageCreate, # Reusing for simplicity, just need .content
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    from app.services.message_service import edit_message
    from app.db.redis import chat_channel, publish
    
    me = await get_participant_by_account(db, account)
    await assert_member(db, chat_id, me.id)
    
    msg = await edit_message(db, message_id, me.id, data.content)
    if not msg:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Message")
        
    # Broadcast the edit
    await publish(chat_channel(str(chat_id)), {
        "event": "message_updated",
        "message": MessageOut.model_validate(msg).model_dump(mode="json"),
    })
    
    return msg
