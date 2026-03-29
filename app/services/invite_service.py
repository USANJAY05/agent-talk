"""
Business logic for the Agent Invite Link + Connection Request system.

Lifecycle:
  1. Owner creates invite  →  AgentInvite row, returns shareable URL
  2. External party GETs invite_code  →  reads agent preview, checks validity
    3. External party POSTs request  →  AgentConnectionRequest row (approved)
    4. System auto-issues AgentToken and sets request.issued_token_id
    5. External party polls GET /request/{id}  →  sees status + token
"""

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models.account import Account
from app.models.agent import (
    Agent,
    AgentConnectionRequest,
    AgentInvite,
    AgentToken,
    ConnectionRequestStatus,
)
from app.models.participant import Participant
from app.schemas.invite import (
    AgentInviteCreate,
    AgentInvitePreview,
    ConnectionRequestCreate,
)
from app.services.agent_service import _assert_owner, generate_agent_token


# ── Invite management ─────────────────────────────────────────────────────────

async def create_invite(
    db: AsyncSession,
    agent: Agent,
    owner: Account,
    data: AgentInviteCreate,
    base_url: str,
) -> AgentInvite:
    """Create a new shareable invite link for an agent."""
    _assert_owner(agent, owner)

    expires_at = None
    if data.expires_in_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_in_hours)

    invite = AgentInvite(
        agent_id=agent.id,
        invite_code=secrets.token_urlsafe(32),
        label=data.label,
        max_uses=data.max_uses,
        expires_at=expires_at,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


async def list_invites(db: AsyncSession, agent: Agent, owner: Account) -> list[AgentInvite]:
    _assert_owner(agent, owner)
    result = await db.scalars(
        select(AgentInvite).where(AgentInvite.agent_id == agent.id).order_by(AgentInvite.created_at.desc())
    )
    return list(result.all())


async def revoke_invite(db: AsyncSession, invite_code: str, owner: Account) -> AgentInvite:
    invite = await _get_invite_by_code(db, invite_code)
    agent = await db.get(Agent, invite.agent_id)
    _assert_owner(agent, owner)
    invite.is_active = False
    await db.commit()
    await db.refresh(invite)
    return invite


async def get_invite_preview(db: AsyncSession, invite_code: str) -> tuple[AgentInvite, Agent, str]:
    """
    Returns (invite, agent, owner_username).
    Does NOT raise on invalid/expired invites — callers check invite.is_active themselves
    so the preview endpoint can show a friendly 'this link has expired' message.
    """
    invite = await _get_invite_by_code(db, invite_code)
    agent = await db.get(Agent, invite.agent_id)
    if not agent:
        raise NotFoundError("Agent")

    # Load owner username
    account = await db.get(Account, agent.owner_id)
    owner_username = account.username if account else "unknown"

    return invite, agent, owner_username


def _check_invite_validity(invite: AgentInvite) -> tuple[bool, str | None]:
    """Returns (is_valid, reason_if_invalid)."""
    if not invite.is_active:
        return False, "This invite link has been revoked."
    if invite.expires_at and invite.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return False, "This invite link has expired."
    if invite.max_uses is not None and invite.use_count >= invite.max_uses:
        return False, "This invite link has reached its maximum number of uses."
    return True, None


# ── Connection request management ─────────────────────────────────────────────

async def submit_connection_request(
    db: AsyncSession,
    invite_code: str,
    data: ConnectionRequestCreate,
) -> AgentConnectionRequest:
    """External party submits a connection request via an invite link.

    Current behavior: request is auto-approved immediately and a connection
    token is issued without manual owner approval.
    """
    invite = await _get_invite_by_code(db, invite_code)
    is_valid, reason = _check_invite_validity(invite)
    if not is_valid:
        raise UnprocessableError(reason or "Invalid invite link")

    # Check for duplicate pending request from same requester name on this invite
    existing = await db.scalar(
        select(AgentConnectionRequest).where(
            AgentConnectionRequest.invite_id == invite.id,
            AgentConnectionRequest.requester_name == data.requester_name,
            AgentConnectionRequest.status == ConnectionRequestStatus.pending,
        )
    )
    if existing:
        raise ConflictError("A pending request from this requester name already exists for this invite.")

    req = AgentConnectionRequest(
        invite_id=invite.id,
        agent_id=invite.agent_id,
        requester_name=data.requester_name,
        requester_username=data.requester_username,
        requester_description=data.requester_description,
        requester_contact=data.requester_contact,
        status=ConnectionRequestStatus.approved,
    )
    db.add(req)
    await db.flush()

    agent = await db.get(Agent, invite.agent_id)
    if not agent:
        raise NotFoundError("Agent")

    owner = await db.get(Account, agent.owner_id)
    if not owner:
        raise NotFoundError("Account")

    token_record = await generate_agent_token(db, agent, owner, f"Auto Approval - {data.requester_name}")

    # If it was a placeholder, initialize identity from the requester payload.
    if agent.is_placeholder:
        agent.name = data.requester_name
        agent.agent_username = data.requester_username
        agent.description = data.requester_description
        agent.is_placeholder = False

        participant = await db.get(Participant, agent.participant_id)
        if participant:
            participant.name = data.requester_name

    req.reviewed_at = datetime.now(timezone.utc)
    req.issued_token_id = token_record.id

    # Bump invite use count
    invite.use_count += 1
    await db.commit()
    await db.refresh(req)

    # ── Notify the agent owner in real-time ───────────────────────────────────
    # Publish to a per-agent Redis channel so the owner's WebSocket connection
    # receives an immediate notification without polling.
    try:
        from app.db.redis import publish
        await publish(
            f"agent_owner:{invite.agent_id}",
            {
                "event": "connection_request_auto_approved",
                "request_id": str(req.id),
                "agent_id": str(req.agent_id),
                "requester_name": req.requester_name,
                "requester_username": req.requester_username,
                "requester_description": req.requester_description,
                "requester_contact": req.requester_contact,
                "status": req.status.value,
                "created_at": req.created_at.isoformat(),
            },
        )
    except Exception:
        pass  # Redis notification is best-effort; don't fail the request

    return req


async def list_requests(
    db: AsyncSession,
    agent: Agent,
    owner: Account,
    status_filter: ConnectionRequestStatus | None = None,
) -> list[AgentConnectionRequest]:
    """Owner sees all connection requests for their agent."""
    _assert_owner(agent, owner)
    q = select(AgentConnectionRequest).where(AgentConnectionRequest.agent_id == agent.id)
    if status_filter:
        q = q.where(AgentConnectionRequest.status == status_filter)
    q = q.order_by(AgentConnectionRequest.created_at.desc())
    result = await db.scalars(q)
    return list(result.all())


async def get_request(db: AsyncSession, request_id: UUID) -> AgentConnectionRequest:
    req = await db.get(AgentConnectionRequest, request_id)
    if not req:
        raise NotFoundError("Connection request")
    return req


async def approve_request(
    db: AsyncSession,
    request_id: UUID,
    agent: Agent,
    owner: Account,
) -> tuple[AgentConnectionRequest, AgentToken]:
    """
    Approve a pending connection request.
    Generates a one-time agent token and stores it on the request record.
    """
    _assert_owner(agent, owner)
    req = await get_request(db, request_id)

    if str(req.agent_id) != str(agent.id):
        raise ForbiddenError("This request does not belong to your agent")
    if req.status != ConnectionRequestStatus.pending:
        raise UnprocessableError(f"Request is already {req.status.value}")

    # Generate the one-time connection token
    token_record = await generate_agent_token(db, agent, owner, f"Invite Approval - {req.requester_name}")

    # If it was a placeholder, fill in the details from the request
    if agent.is_placeholder:
        agent.name = req.requester_name
        agent.agent_username = req.requester_username
        agent.description = req.requester_description
        agent.is_placeholder = False
        
        # Sync participant name too
        from app.models.participant import Participant
        participant = await db.get(Participant, agent.participant_id)
        if participant:
            participant.name = req.requester_name

    req.status = ConnectionRequestStatus.approved
    req.reviewed_at = datetime.now(timezone.utc)
    req.issued_token_id = token_record.id

    await db.commit()
    await db.refresh(req)
    await db.refresh(agent)
    await db.refresh(token_record)
    return req, token_record


async def reject_request(
    db: AsyncSession,
    request_id: UUID,
    agent: Agent,
    owner: Account,
    reason: str | None,
) -> AgentConnectionRequest:
    """Reject a pending connection request."""
    _assert_owner(agent, owner)
    req = await get_request(db, request_id)

    if str(req.agent_id) != str(agent.id):
        raise ForbiddenError("This request does not belong to your agent")
    if req.status != ConnectionRequestStatus.pending:
        raise UnprocessableError(f"Request is already {req.status.value}")

    req.status = ConnectionRequestStatus.rejected
    req.rejection_reason = reason
    req.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(req)
    return req


async def get_request_status(
    db: AsyncSession,
    request_id: UUID,
    invite_code: str,
) -> tuple[AgentConnectionRequest, str | None]:
    """
    Public status poll endpoint — requester checks if they've been approved/rejected.
    Returns (request, connection_token_or_None).
    The invite_code acts as a lightweight auth so random people can't enumerate requests.
    """
    req = await get_request(db, request_id)

    # Verify this request belongs to the invite
    invite = await _get_invite_by_code(db, invite_code)
    if str(req.invite_id) != str(invite.id):
        raise ForbiddenError("Request does not match this invite")

    connection_token: str | None = None
    if req.status == ConnectionRequestStatus.approved and req.issued_token_id:
        token_record = await db.get(AgentToken, req.issued_token_id)
        if token_record and not token_record.used:
            connection_token = token_record.token

    return req, connection_token


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _get_invite_by_code(db: AsyncSession, code: str) -> AgentInvite:
    invite = await db.scalar(select(AgentInvite).where(AgentInvite.invite_code == code))
    if not invite:
        raise NotFoundError("Invite link")
    return invite


def build_invite_url(base_url: str, invite_code: str) -> str:
    """Build the shareable URL from the base URL and invite code."""
    base_url = base_url.rstrip("/")
    return f"{base_url}/invite/{invite_code}"
