"""Participant lookup utilities."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.account import Account
from app.models.participant import Participant
from app.schemas.participant import ParticipantUpdate


async def get_participant_by_account(db: AsyncSession, account: Account) -> Participant:
    result = await db.scalar(select(Participant).where(Participant.account_id == account.id))
    if not result:
        raise NotFoundError("Participant for this account")
    result.email = account.email
    return result


async def get_participant(db: AsyncSession, participant_id: UUID) -> Participant:
    p = await db.scalar(
        select(Participant)
        .where(Participant.id == participant_id)
        .outerjoin(Account, Participant.account_id == Account.id)
    )
    if not p:
        raise NotFoundError("Participant")
    
    # We can attach the email to the object for Pydantic to pick it up
    if p.account_id:
        account = await db.get(Account, p.account_id)
        if account:
            p.email = account.email
    return p


async def list_participants(db: AsyncSession, skip: int = 0, limit: int = 100, query: str | None = None) -> list[Participant]:
    from sqlalchemy import or_
    stmt = select(Participant)
    if query:
        conditions = [
            Participant.name.ilike(f"%{query}%"),
            Participant.username.ilike(f"%{query}%")
        ]
        try:
            val_uuid = UUID(query)
            conditions.append(Participant.id == val_uuid)
        except ValueError:
            pass
            
        stmt = stmt.where(or_(*conditions))
    result = await db.scalars(stmt.offset(skip).limit(limit))
    return list(result.all())


async def list_accessible_participants(
    db: AsyncSession, account_id: UUID, skip: int = 0, limit: int = 100
) -> list[Participant]:
    """
    Returns participants that the given account is allowed to see/search:
    - All human participants.
    - Public agents.
    - Agents owned by this account.
    - Agents explicitly shared with this account.
    """
    from app.models.agent import Agent, AgentAccess, AgentVisibility
    from app.models.participant import ParticipantType
    from sqlalchemy import or_, and_, exists

    stmt = (
        select(Participant)
        .outerjoin(Agent, Participant.id == Agent.participant_id)
        .where(
            or_(
                Participant.type == ParticipantType.human,
                and_(
                    Participant.type == ParticipantType.agent,
                    Agent.is_placeholder == False,
                    or_(
                        Agent.visibility == AgentVisibility.public,
                        Agent.owner_id == account_id,
                        exists().where(
                            and_(
                                AgentAccess.agent_id == Agent.id,
                                AgentAccess.account_id == account_id
                            )
                        )
                    )
                )
            )
        )
        .offset(skip)
        .limit(limit)
    )
    
    result = await db.scalars(stmt)
    return list(result.all())


async def update_participant(
    db: AsyncSession, participant_id: UUID, account_id: UUID, data: "ParticipantUpdate"
) -> Participant:
    """Update participant profile (tags, name, metadata)."""
    from app.core.exceptions import ForbiddenError
    from app.models.agent import Agent
    
    p = await get_participant(db, participant_id)
    
    # Check permissions
    if p.account_id:
        # Human updating themselves
        if p.account_id != account_id:
            raise ForbiddenError("You can only update your own profile")
    else:
        # Agent update - requester must be the owner of the agent
        agent = await db.scalar(select(Agent).where(Agent.participant_id == p.id))
        if not agent or agent.owner_id != account_id:
             raise ForbiddenError("You can only update agents you own")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(p, field, value)
        
    await db.commit()
    await db.refresh(p)
    return p
