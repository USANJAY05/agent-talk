"""Participant lookup endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.schemas.participant import ParticipantOut, ParticipantUpdate
from app.services.participant_service import (
    get_participant,
    get_participant_by_account,
    list_participants,
    update_participant,
)

router = APIRouter()


@router.get("/me", response_model=ParticipantOut,
    summary="Get your own Participant record")
async def my_participant(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    return await get_participant_by_account(db, account)


@router.patch("/{participant_id}", response_model=ParticipantOut,
    summary="Update participant profile (tags, name, bio)")
async def update_one(
    participant_id: UUID,
    data: ParticipantUpdate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    # Only owner can update themselves or their agents
    return await update_participant(db, participant_id, account.id, data)


@router.get("/{participant_id}", response_model=ParticipantOut,
    summary="Get a participant by ID")
async def get_one(
    participant_id: UUID,
    _: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    return await get_participant(db, participant_id)


@router.get("/", response_model=list[ParticipantOut],
    summary="List all participants (paginated/search)")
async def list_all(
    query: str | None = Query(None, min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    return await list_participants(db, skip=skip, limit=limit, query=query)
