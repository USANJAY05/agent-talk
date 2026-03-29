"""Agent management endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.schemas.agent import (
    AgentAccessGrant,
    AgentCreate,
    AgentTokenCreate,
    AgentOut,
    AgentTokenOut,
    AgentUpdate,
)
from app.models.agent import AgentVisibility
from app.services.agent_service import (
    assert_agent_accessible,
    create_agent,
    create_agent_invite_only,
    delete_agent,
    generate_agent_token,
    get_agent,
    grant_access,
    list_accessible_agents,
    list_owned_agents,
    revoke_agent_token,
    revoke_access,
    update_agent,
)

router = APIRouter()


@router.post("/", response_model=AgentOut, status_code=201,
    summary="Create a new agent")
async def create(
    data: AgentCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates an agent owned by the authenticated user.
    A Participant record of type `agent` is automatically created and linked.
    """
    return await create_agent(db, account, data)


class AgentInviteOnlyCreate(BaseModel):
    label: str
    visibility: AgentVisibility


class AgentInviteOnlyOut(BaseModel):
    agent: AgentOut
    invite_code: str


@router.post("/invite-only", response_model=AgentInviteOnlyOut, status_code=201,
    summary="Quickly create a placeholder agent and an invite link")
async def create_invite_only(
    data: AgentInviteOnlyCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent, invite_code = await create_agent_invite_only(db, account, data.label, data.visibility)
    return {"agent": agent, "invite_code": invite_code}


@router.get("/mine", response_model=list[AgentOut],
    summary="List agents you own")
async def list_mine(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    return await list_owned_agents(db, account.id)


@router.get("/accessible", response_model=list[AgentOut],
    summary="List agents accessible to you (public + shared)")
async def list_accessible(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    return await list_accessible_agents(db, account.id)


@router.get("/{agent_id}", response_model=AgentOut,
    summary="Get agent details")
async def get_one(
    agent_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    await assert_agent_accessible(db, agent, account.id)
    return agent


@router.patch("/{agent_id}", response_model=AgentOut,
    summary="Update an agent you own")
async def update(
    agent_id: UUID,
    data: AgentUpdate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    return await update_agent(db, agent, account, data)


@router.delete("/{agent_id}", status_code=204,
    summary="Delete an agent you own")
async def delete(
    agent_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    await delete_agent(db, agent, account)


# ── Token management ──────────────────────────────────────────────────────────

@router.post("/{agent_id}/tokens", response_model=AgentTokenOut, status_code=201,
    summary="Generate or fetch an active connection token for an agent")
async def issue_token(
    agent_id: UUID,
    body: AgentTokenCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Issues a JWT the agent presents to `/ws/agent/connect`.
    Exactly one token record is maintained per agent and rotated on each generation.
    Token remains valid until explicitly revoked.
    Deleted/inactive agents cannot issue new tokens.
    """
    agent = await get_agent(db, agent_id)
    token_record = await generate_agent_token(db, agent, account, body.name)
    return AgentTokenOut(name=token_record.name, token=token_record.token, pairing_code=token_record.pairing_code)


@router.delete("/{agent_id}/tokens", status_code=204,
    summary="Revoke the current connection token for an agent")
async def revoke_token(
    agent_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    await revoke_agent_token(db, agent, account)


# ── Access control ────────────────────────────────────────────────────────────

@router.get("/{agent_id}/access", response_model=list[UUID],
    summary="List account IDs with access to this shared agent")
async def get_access_list(
    agent_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    from app.services.agent_service import list_access
    return await list_access(db, agent, account)


@router.post("/{agent_id}/access", status_code=204,
    summary="Grant a user access to a shared agent")
async def grant(
    agent_id: UUID,
    body: AgentAccessGrant,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    await grant_access(db, agent, account, body.account_id)


@router.delete("/{agent_id}/access/{target_account_id}", status_code=204,
    summary="Revoke a user's access to a shared agent")
async def revoke(
    agent_id: UUID,
    target_account_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    await revoke_access(db, agent, account, target_account_id)


# ── Owner presence toggle ──────────────────────────────────────────────────────

class OwnerPresenceUpdate(BaseModel):
    owner_presence: bool


@router.patch("/{agent_id}/presence", response_model=AgentOut,
    summary="Toggle owner presence for an agent",
    description=(
        "Controls whether the agent's owner is automatically added as a member "
        "to every chat this agent joins (direct or group). "
        "**Default: `true`**. Set `false` to let the agent operate without the owner "
        "being auto-enrolled in its conversations."
    ))
async def toggle_presence(
    agent_id: UUID,
    body: OwnerPresenceUpdate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    from app.schemas.agent import AgentUpdate
    return await update_agent(db, agent, account, AgentUpdate(owner_presence=body.owner_presence))


class AgentTransfer(BaseModel):
    new_owner_id: UUID


@router.post("/{agent_id}/transfer", response_model=AgentOut,
    summary="Transfer agent ownership to another user")
async def transfer(
    agent_id: UUID,
    body: AgentTransfer,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Destructive: immediately transfers ownership of the agent to the specified account.
    You will lose all management rights over the agent.
    """
    from app.services.agent_service import transfer_agent_ownership
    agent = await get_agent(db, agent_id)
    return await transfer_agent_ownership(db, agent, account, body.new_owner_id)
