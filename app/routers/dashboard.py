"""Dashboard / summary endpoints for authenticated users."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.schemas.agent import AgentOut
from app.schemas.chat import ChatOut
from app.schemas.participant import ParticipantOut
from app.services.agent_service import list_accessible_agents, list_owned_agents
from app.services.chat_service import list_chats_for_participant
from app.services.participant_service import get_participant_by_account, list_participants

router = APIRouter()


class DashboardSummary(BaseModel):
    chats: list[ChatOut]
    owned_agents: list[AgentOut]
    accessible_agents: list[AgentOut]
    my_participant: ParticipantOut


@router.get("/", response_model=DashboardSummary,
    summary="Dashboard summary — chats, agents, participant info")
async def dashboard(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns everything a client needs to render a dashboard in a single call:
    - All chats the user belongs to
    - Agents the user owns
    - Agents accessible to the user (public + shared)
    - The user's own Participant record
    """
    me = await get_participant_by_account(db, account)
    chats = await list_chats_for_participant(db, me.id)
    owned = await list_owned_agents(db, account.id)
    accessible = await list_accessible_agents(db, account.id)
    return DashboardSummary(
        chats=chats,
        owned_agents=owned,
        accessible_agents=accessible,
        my_participant=me,
    )


@router.get("/participants", response_model=list[ParticipantOut],
    summary="List all platform participants")
async def all_participants(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    from app.services.participant_service import list_accessible_participants
    return await list_accessible_participants(db, account.id, skip=0, limit=200)
