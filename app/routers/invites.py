"""
Agent Invite Link & Connection Request endpoints.

These routes are mounted under /api/v1/agents and extend the existing agent router.

Owner-facing (auth required):
  POST   /agents/{id}/invites                          – create shareable link
  GET    /agents/{id}/invites                          – list all invite links
  DELETE /agents/{id}/invites/{code}/revoke            – revoke a link
  GET    /agents/{id}/requests                         – list connection requests
  GET    /agents/{id}/requests/{rid}                   – get single request
  POST   /agents/{id}/requests/{rid}/approve           – approve → issues token
  POST   /agents/{id}/requests/{rid}/reject            – reject with reason

Public (no auth):
  GET    /agents/invite/{code}                         – preview agent card
    POST   /agents/invite/{code}/request                 – submit connection request (auto-approved)
    GET    /agents/invite/{code}/request/{rid}/status    – poll status / token
"""

from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.models.account import Account
from app.models.agent import ConnectionRequestStatus
from app.schemas.invite import (
    AgentInviteCreate,
    AgentInviteOut,
    AgentInvitePreview,
    ApproveResult,
    ConnectionRequestCreate,
    ConnectionRequestOut,
    RejectRequest,
    RevokeInviteResult,
)
from app.services.agent_service import get_agent
from app.services.invite_service import (
    _check_invite_validity,
    approve_request,
    build_invite_url,
    create_invite,
    get_invite_preview,
    get_request,
    get_request_status,
    list_invites,
    list_requests,
    reject_request,
    revoke_invite,
    submit_connection_request,
)

router = APIRouter()


def _public_base_url(request: Request) -> str:
    # Prefer browser origin so invite links point to the frontend host.
    return request.headers.get("origin") or str(request.base_url)


# ═════════════════════════════════════════════════════════════════════════════
#  PUBLIC — no auth required
# ═════════════════════════════════════════════════════════════════════════════

@router.get(
    "/invite/{invite_code}",
    response_model=AgentInvitePreview,
    summary="Preview agent details via invite link (public)",
    description=(
        "Returns the agent's public card so the connecting party can decide "
        "whether to submit a connection request. Works even if the invite is "
        "expired/revoked — `is_valid` will be False with a reason."
    ),
)
async def preview_invite(
    invite_code: str,
    db: AsyncSession = Depends(get_db),
):
    invite, agent, owner_username = await get_invite_preview(db, invite_code)
    is_valid, invalid_reason = _check_invite_validity(invite)
    return AgentInvitePreview(
        agent_id=agent.id,
        agent_name=agent.name,
        agent_description=agent.description,
        owner_username=owner_username,
        invite_code=invite_code,
        invite_label=invite.label,
        is_valid=is_valid,
        invalid_reason=invalid_reason,
    )


@router.post(
    "/invite/{invite_code}/request",
    response_model=ConnectionRequestOut,
    status_code=201,
    summary="Submit a connection request via invite link (public)",
    description=(
        "The connecting party submits identity and intent. "
        "Request is auto-approved and returns a connection token immediately. "
        "Poll `GET /agents/invite/{code}/request/{id}/status` if needed."
    ),
)
async def submit_request(
    invite_code: str,
    data: ConnectionRequestCreate,
    db: AsyncSession = Depends(get_db),
):
    req = await submit_connection_request(db, invite_code, data)
    connection_token = None
    if req.issued_token_id:
        from app.models.agent import AgentToken
        token_record = await db.get(AgentToken, req.issued_token_id)
        connection_token = token_record.token if token_record else None
    return _request_to_out(req, connection_token=connection_token)


@router.get(
    "/invite/{invite_code}/request/{request_id}/status",
    response_model=ConnectionRequestOut,
    summary="Poll connection request status (public)",
    description=(
        "The connecting party polls this endpoint to fetch latest status and token. "
        "In auto-approval mode, status is typically `approved` immediately."
    ),
)
async def poll_request_status(
    invite_code: str,
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    req, token = await get_request_status(db, request_id, invite_code)
    return _request_to_out(req, connection_token=token)


# ═════════════════════════════════════════════════════════════════════════════
#  OWNER — auth required
# ═════════════════════════════════════════════════════════════════════════════

@router.post(
    "/{agent_id}/invites",
    response_model=AgentInviteOut,
    status_code=201,
    summary="Create a shareable invite link for an agent",
    description=(
        "Generates a unique invite link you can share with external systems or "
        "individuals. They use it to view your agent and request a connection."
    ),
)
async def create_agent_invite(
    agent_id: UUID,
    data: AgentInviteCreate,
    request: Request,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    base_url = _public_base_url(request)
    invite = await create_invite(db, agent, account, data, base_url)
    return _invite_to_out(invite, base_url)


@router.get(
    "/{agent_id}/invites",
    response_model=list[AgentInviteOut],
    summary="List all invite links for an agent",
)
async def list_agent_invites(
    agent_id: UUID,
    request: Request,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    invites = await list_invites(db, agent, account)
    base_url = _public_base_url(request)
    return [_invite_to_out(inv, base_url) for inv in invites]


@router.delete(
    "/{agent_id}/invites/{invite_code}/revoke",
    response_model=RevokeInviteResult,
    summary="Revoke an invite link",
    description="Revoked links immediately stop accepting new requests.",
)
async def revoke_agent_invite(
    agent_id: UUID,
    invite_code: str,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    invite = await revoke_invite(db, invite_code, account)
    return RevokeInviteResult(id=invite.id, is_active=invite.is_active)


@router.get(
    "/{agent_id}/requests",
    response_model=list[ConnectionRequestOut],
    summary="List connection requests for an agent",
    description="Filter by status: `pending`, `approved`, or `rejected`.",
)
async def list_agent_requests(
    agent_id: UUID,
    status: Optional[ConnectionRequestStatus] = Query(None, description="Filter by status"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    requests = await list_requests(db, agent, account, status_filter=status)
    return [_request_to_out(r, connection_token=None) for r in requests]


@router.get(
    "/{agent_id}/requests/{request_id}",
    response_model=ConnectionRequestOut,
    summary="Get a single connection request",
)
async def get_agent_request(
    agent_id: UUID,
    request_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    req = await get_request(db, request_id)
    from app.core.exceptions import ForbiddenError
    if str(req.agent_id) != str(agent_id):
        raise ForbiddenError("Request does not belong to this agent")
    return _request_to_out(req, connection_token=None)


@router.post(
    "/{agent_id}/requests/{request_id}/approve",
    response_model=ApproveResult,
    summary="Approve a connection request",
    description=(
        "Approves the request and issues a **persistent connection token**. "
        "Share the token with the connecting party — they use it in the "
        "`/ws/agent/connect` WebSocket handshake. The token remains valid "
        "until explicitly revoked via `DELETE /api/v1/agents/{id}/tokens`."
    ),
)
async def approve_agent_request(
    agent_id: UUID,
    request_id: UUID,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    req, token_record = await approve_request(db, request_id, agent, account)
    return ApproveResult(
        request_id=req.id,
        status=req.status,
        connection_token=token_record.token,
        token_expires_at=token_record.expires_at,
    )


@router.post(
    "/{agent_id}/requests/{request_id}/reject",
    response_model=ConnectionRequestOut,
    summary="Reject a connection request",
)
async def reject_agent_request(
    agent_id: UUID,
    request_id: UUID,
    body: RejectRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    agent = await get_agent(db, agent_id)
    req = await reject_request(db, request_id, agent, account, body.reason)
    return _request_to_out(req, connection_token=None)


# ── Response builders ─────────────────────────────────────────────────────────

def _invite_to_out(invite, base_url: str) -> AgentInviteOut:
    return AgentInviteOut(
        id=invite.id,
        agent_id=invite.agent_id,
        invite_code=invite.invite_code,
        invite_url=build_invite_url(base_url, invite.invite_code),
        label=invite.label,
        max_uses=invite.max_uses,
        use_count=invite.use_count,
        is_active=invite.is_active,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
    )


def _request_to_out(req, connection_token: str | None) -> ConnectionRequestOut:
    return ConnectionRequestOut(
        id=req.id,
        agent_id=req.agent_id,
        invite_id=req.invite_id,
        requester_name=req.requester_name,
        requester_username=req.requester_username,
        requester_description=req.requester_description,
        requester_contact=req.requester_contact,
        status=req.status,
        rejection_reason=req.rejection_reason,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
        connection_token=connection_token,
    )
