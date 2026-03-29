"""Chat and group membership endpoints."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.db.redis import chat_channel, publish
from app.schemas.chat import (
    AddMemberRequest,
    ChatMemberOut,
    ChatOut,
    ChatUpdate,
    DirectChatCreate,
    GroupChatCreate,
    UpdateMemberRole,
)
from app.services.chat_service import (
    add_member,
    assert_member,
    clear_chat,
    create_direct_chat,
    create_group_chat,
    get_chat,
    list_chats_for_participant,
    list_public_groups,
    list_members,
    mark_chat_as_read,
    remove_member,
    update_member_role,
)
from app.services.participant_service import get_participant_by_account

router = APIRouter()


# ── Chat creation ─────────────────────────────────────────────────────────────

@router.post("/direct", response_model=ChatOut, status_code=201,
    summary="Start or retrieve a direct (1:1) chat")
async def start_direct(
    data: DirectChatCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a direct chat between you and another participant.
    Returns the existing chat if one already exists.
    """
    me = await get_participant_by_account(db, account)
    return await create_direct_chat(db, me.id, data)


@router.post("/group", response_model=ChatOut, status_code=201,
    summary="Create a group chat")
async def start_group(
    data: GroupChatCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    return await create_group_chat(db, me.id, data)


@router.get("/public", response_model=list[ChatOut],
    summary="Search for public group chats")
async def search_public(
    query: str | None = None,
    skip: int = 0,
    limit: int = 50,
    _: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a list of public groups matching the search query.
    Used for discovery of open communities.
    """
    return await list_public_groups(db, query=query, skip=skip, limit=limit)


# ── Chat listing ──────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ChatOut],
    summary="List all chats you belong to")
async def list_my_chats(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    return await list_chats_for_participant(db, me.id)


@router.get("/{chat_id}", response_model=ChatOut,
    summary="Get chat details")
async def get_one(
    chat_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    chat = await get_chat(db, chat_id)
    await assert_member(db, chat_id, me.id)
    return chat


@router.delete("/{chat_id}", status_code=204,
    summary="Leave and potentially delete a chat")
async def delete_one(
    chat_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Removes you from the chat. If you are the last human member, 
    the chat and its history are permanently deleted.
    """
    me = await get_participant_by_account(db, account)
    from app.services.chat_service import leave_chat
    await leave_chat(db, chat_id, me.id)


@router.post("/{chat_id}/read", status_code=204,
    summary="Mark all messages in a chat as read")
async def mark_read(
    chat_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    read_at = await mark_chat_as_read(db, chat_id, me.id)
    await publish(
        chat_channel(str(chat_id)),
        {
            "event": "read_event",
            "chat_id": str(chat_id),
            "participant_id": str(me.id),
            "read_at": (read_at or datetime.now(timezone.utc)).isoformat(),
        },
    )


@router.post("/{chat_id}/clear", status_code=204,
    summary="Delete all messages in a chat")
async def clear_messages(
    chat_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    await clear_chat(db, chat_id, me.id)


@router.patch("/{chat_id}", response_model=ChatOut,
    summary="Update chat metadata (name, tags, visibility)")
async def update_one(
    chat_id: UUID,
    data: ChatUpdate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    from app.services.chat_service import update_chat
    me = await get_participant_by_account(db, account)
    return await update_chat(db, chat_id, me.id, data)


# ── Member management ─────────────────────────────────────────────────────────

@router.get("/{chat_id}/members", response_model=list[ChatMemberOut],
    summary="List chat members")
async def members(
    chat_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    await assert_member(db, chat_id, me.id)
    return await list_members(db, chat_id)


@router.post("/{chat_id}/members", response_model=ChatMemberOut, status_code=201,
    summary="Add a participant to a group chat (admin only)")
async def add(
    chat_id: UUID,
    body: AddMemberRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    chat = await get_chat(db, chat_id)
    return await add_member(db, chat, me.id, body.participant_id, body.role)


@router.delete("/{chat_id}/members/{participant_id}", status_code=204,
    summary="Remove a participant from a group chat (admin only)")
async def remove(
    chat_id: UUID,
    participant_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    chat = await get_chat(db, chat_id)
    await remove_member(db, chat, me.id, participant_id)


@router.patch("/{chat_id}/members/{participant_id}", response_model=ChatMemberOut,
    summary="Update a member's role (admin only)")
async def change_role(
    chat_id: UUID,
    participant_id: UUID,
    body: UpdateMemberRole,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    chat = await get_chat(db, chat_id)
    return await update_member_role(db, chat, me.id, participant_id, body.role)
