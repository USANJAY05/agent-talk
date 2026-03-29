"""
Group management endpoints.

Groups are just group-type chats exposed through a dedicated resource path
for discoverability and clarity.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.models.chat import Chat, ChatType
from app.schemas.chat import ChatOut, GroupChatCreate
from app.services.chat_service import create_group_chat, list_chats_for_participant
from app.services.participant_service import get_participant_by_account

router = APIRouter()


@router.post("/", response_model=ChatOut, status_code=201,
    summary="Create a group")
async def create_group(
    data: GroupChatCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """Alias for POST /chats/group — provided for REST discoverability."""
    me = await get_participant_by_account(db, account)
    return await create_group_chat(db, me.id, data)


@router.get("/", response_model=list[ChatOut],
    summary="List group chats you belong to")
async def list_groups(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    me = await get_participant_by_account(db, account)
    all_chats = await list_chats_for_participant(db, me.id)
    return [c for c in all_chats if c.type == ChatType.group]
