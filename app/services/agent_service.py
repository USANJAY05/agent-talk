"""Business logic for agent lifecycle management."""

import uuid
import secrets
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.security import create_agent_token
from app.models.account import Account
from app.models.agent import Agent, AgentAccess, AgentToken, AgentVisibility, AgentInvite
from app.models.participant import Participant, ParticipantType
from app.schemas.agent import AgentCreate, AgentUpdate


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def create_agent(db: AsyncSession, owner: Account, data: AgentCreate) -> Agent:
    """Create an agent and its linked Participant."""
    # Check name uniqueness per owner
    existing = await db.scalar(
        select(Agent).where(
            Agent.owner_id == owner.id,
            Agent.name == data.name,
            Agent.is_active == True,
        )
    )
    if existing:
        raise ConflictError(f"You already have an agent named '{data.name}'")

    participant = Participant(
        type=ParticipantType.agent,
        name=data.name,
        metadata_={"identity_initialized": False},
    )
    db.add(participant)
    await db.flush()

    visibility = AgentVisibility.private if data.is_automation else data.visibility

    agent = Agent(
        name=data.name,
        description=data.description,
        visibility=visibility,
        passive_listen=data.passive_listen,
        owner_presence=data.owner_presence,
        owner_id=owner.id,
        participant_id=participant.id,
        is_automation=data.is_automation,
    )
    db.add(agent)
    await db.flush()

    # Process allowlist if visibility is shared
    if visibility == AgentVisibility.shared and data.allowed_account_ids:
        for acc_id in data.allowed_account_ids:
            db.add(AgentAccess(agent_id=agent.id, account_id=acc_id))

    await db.commit()
    await db.refresh(agent)
    return agent


async def create_agent_invite_only(db: AsyncSession, owner: Account, label: str, visibility: AgentVisibility) -> tuple[Agent, str]:
    """
    Simplified workflow: create a placeholder agent and an invite link for it.
    The agent details will be filled when it connects via the invite.
    """
    # Create a hidden placeholder participant
    participant = Participant(
        type=ParticipantType.agent,
        name=label,
        metadata_={"identity_initialized": False},
    )
    db.add(participant)
    await db.flush()

    agent = Agent(
        name=label,
        visibility=visibility,
        is_placeholder=True,
        is_automation=False,
        owner_id=owner.id,
        participant_id=participant.id,
    )
    db.add(agent)
    await db.flush()

    # Create the invite
    import secrets
    invite = AgentInvite(
        agent_id=agent.id,
        invite_code=secrets.token_urlsafe(32),
        label=label,
        max_uses=1, # Usually one-time for this flow
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    # Expose invite code in immediate create response for UI convenience.
    agent.invite_code = invite.invite_code
    return agent, invite.invite_code


async def get_agent(db: AsyncSession, agent_id: UUID) -> Agent:
    result = await db.execute(
        select(Agent)
        .where(Agent.id == agent_id, Agent.is_active == True)
        .options(selectinload(Agent.invites))
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise NotFoundError("Agent")
    # Populate invite_code if it's a placeholder
    if agent.is_placeholder and agent.invites:
        active_invite = next((i for i in agent.invites if i.is_active), None)
        if active_invite:
            agent.invite_code = active_invite.invite_code
    return agent


async def update_agent(db: AsyncSession, agent: Agent, owner: Account, data: AgentUpdate) -> Agent:
    _assert_owner(agent, owner)
    if data.name is not None:
        agent.name = data.name
        # keep participant name in sync
        participant = await db.get(Participant, agent.participant_id)
        if participant:
            participant.name = data.name
    if data.description is not None:
        agent.description = data.description
    if data.visibility is not None:
        agent.visibility = AgentVisibility.private if agent.is_automation else data.visibility
    if data.passive_listen is not None:
        agent.passive_listen = data.passive_listen
    if data.owner_presence is not None:
        agent.owner_presence = data.owner_presence
    await db.commit()
    await db.refresh(agent)
    return agent


async def delete_agent(db: AsyncSession, agent: Agent, owner: Account) -> None:
    _assert_owner(agent, owner)

    # Keep related records (including tokens) for audit/recovery while disabling the agent.
    participant = await db.get(Participant, agent.participant_id)
    if participant:
        participant.name = "Deleted Agent"

    agent.is_active = False
    await db.commit()


async def list_owned_agents(db: AsyncSession, owner_id: UUID) -> list[Agent]:
    result = await db.scalars(
        select(Agent)
        .where(Agent.owner_id == owner_id, Agent.is_active == True)
        .options(selectinload(Agent.invites))
    )
    agents = list(result.all())
    for agent in agents:
        if agent.is_placeholder and agent.invites:
            active_invite = next((i for i in agent.invites if i.is_active), None)
            if active_invite:
                agent.invite_code = active_invite.invite_code
    return agents


async def list_accessible_agents(db: AsyncSession, account_id: UUID) -> list[Agent]:
    """Return public agents + shared agents the account has access to."""
    public = await db.scalars(
        select(Agent).where(Agent.visibility == AgentVisibility.public, Agent.is_active == True)
    )
    shared_ids_result = await db.scalars(
        select(AgentAccess.agent_id).where(AgentAccess.account_id == account_id)
    )
    shared_ids = list(shared_ids_result.all())
    shared: list[Agent] = []
    if shared_ids:
        shared_result = await db.scalars(
            select(Agent).where(Agent.id.in_(shared_ids), Agent.is_active == True)
        )
        shared = list(shared_result.all())
    return list(public.all()) + shared


# ── Token generation ──────────────────────────────────────────────────────────

async def generate_agent_token(db: AsyncSession, agent: Agent, owner: Account, token_name: str) -> AgentToken:
    """Generate (rotate) a connection token associated with the agent."""
    _assert_owner(agent, owner)
    if not agent.is_active:
        raise ForbiddenError("Cannot issue token for inactive/deleted agent")

    now = datetime.now(timezone.utc)
    existing = await db.scalar(
        select(AgentToken)
        .where(AgentToken.agent_id == agent.id)
        .order_by(AgentToken.created_at.desc())
    )
    if existing:
        # Rotate existing per-agent token record (one token record per agent).
        jti = str(uuid.uuid4())
        pairing_code = f"{secrets.randbelow(1_000_000):06d}"
        existing.jti = jti
        existing.name = token_name.strip()
        existing.token = create_agent_token(str(agent.id), jti)
        existing.expires_at = None
        existing.pairing_code = pairing_code
        existing.is_paired = False
        existing.paired_at = None
        existing.used = False
        existing.created_at = now
        await db.commit()
        await db.refresh(existing)
        return existing

    jti = str(uuid.uuid4())
    pairing_code = f"{secrets.randbelow(1_000_000):06d}"
    raw_token = create_agent_token(str(agent.id), jti)

    token_record = AgentToken(
        agent_id=agent.id,
        jti=jti,
        name=token_name.strip(),
        token=raw_token,
        pairing_code=pairing_code,
        is_paired=False,
        expires_at=None,
    )
    db.add(token_record)
    await db.commit()
    await db.refresh(token_record)
    return token_record


async def revoke_agent_token(db: AsyncSession, agent: Agent, owner: Account) -> bool:
    """Revoke the current token for this agent. Returns True if a token was revoked."""
    _assert_owner(agent, owner)

    token_record = await db.scalar(
        select(AgentToken)
        .where(AgentToken.agent_id == agent.id)
        .order_by(AgentToken.created_at.desc())
    )
    if not token_record:
        return False

    await db.delete(token_record)
    await db.commit()
    return True


async def consume_agent_token(db: AsyncSession, jti: str, token_agent_id: str | None = None) -> Agent:
    """
    Validate a token and return its associated agent.
    Returns the associated Agent on success.
    """
    from fastapi import HTTPException, status

    token_record = await db.scalar(select(AgentToken).where(AgentToken.jti == jti))
    if not token_record:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    if token_agent_id and str(token_record.agent_id) != token_agent_id:
        raise HTTPException(status_code=401, detail="Agent token mismatch")

    agent = await get_agent(db, token_record.agent_id)
    return agent


# ── Access grants ─────────────────────────────────────────────────────────────

async def grant_access(db: AsyncSession, agent: Agent, owner: Account, target_account_id: UUID) -> None:
    _assert_owner(agent, owner)
    existing = await db.scalar(
        select(AgentAccess).where(
            AgentAccess.agent_id == agent.id,
            AgentAccess.account_id == target_account_id,
        )
    )
    if existing:
        return  # idempotent
    db.add(AgentAccess(agent_id=agent.id, account_id=target_account_id))
    await db.commit()


async def list_access(db: AsyncSession, agent: Agent, owner: Account) -> list[UUID]:
    _assert_owner(agent, owner)
    result = await db.scalars(
        select(AgentAccess.account_id).where(AgentAccess.agent_id == agent.id)
    )
    return list(result.all())


async def revoke_access(db: AsyncSession, agent: Agent, owner: Account, target_account_id: UUID) -> None:
    _assert_owner(agent, owner)
    record = await db.scalar(
        select(AgentAccess).where(
            AgentAccess.agent_id == agent.id,
            AgentAccess.account_id == target_account_id,
        )
    )
    if record:
        await db.delete(record)
        await db.commit()


# ── Visibility check ──────────────────────────────────────────────────────────

async def assert_agent_accessible(db: AsyncSession, agent: Agent, account_id: UUID) -> None:
    """Raise ForbiddenError if account cannot use this agent."""
    if agent.visibility == AgentVisibility.public:
        return
    if str(agent.owner_id) == str(account_id):
        return
    if agent.visibility == AgentVisibility.shared:
        grant = await db.scalar(
            select(AgentAccess).where(
                AgentAccess.agent_id == agent.id,
                AgentAccess.account_id == account_id,
            )
        )
        if grant:
            return
    raise ForbiddenError("You do not have access to this agent")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _assert_owner(agent: Agent, account: Account) -> None:
    """Private alias kept for backward compat. Use assert_agent_owner() in new code."""
    if str(agent.owner_id) != str(account.id):
        raise ForbiddenError("You do not own this agent")


# Public alias — used by invite_service and any future service that needs ownership checks
assert_agent_owner = _assert_owner


async def transfer_agent_ownership(db: AsyncSession, agent: Agent, owner: Account, new_owner_id: UUID) -> Agent:
    """Transfer agent to a new owner."""
    _assert_owner(agent, owner)
    
    # Check new owner exists
    from app.models.account import Account
    new_owner = await db.get(Account, new_owner_id)
    if not new_owner:
        raise NotFoundError("New owner account")
        
    agent.owner_id = new_owner_id
    await db.commit()
    await db.refresh(agent)
    return agent
