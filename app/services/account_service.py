"""Business logic for human account management."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, UnprocessableError
from app.core.security import hash_password, verify_password
from app.models.account import Account
from app.models.participant import Participant, ParticipantType
from app.schemas.auth import RegisterRequest


async def register_account(db: AsyncSession, data: RegisterRequest) -> Account:
    """Create a new human account and its linked Participant."""
    # uniqueness checks
    existing_email = await db.scalar(select(Account).where(Account.email == data.email))
    if existing_email:
        raise ConflictError("Email already registered")

    existing_username = await db.scalar(select(Account).where(Account.username == data.username))
    if existing_username:
        raise ConflictError("Username already taken")

    account = Account(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        bio=data.bio,
    )
    db.add(account)
    await db.flush()  # get account.id before linking participant

    participant = Participant(
        type=ParticipantType.human,
        name=data.name or data.username,
        username=data.username,
        account_id=account.id,
        metadata_={},
    )
    db.add(participant)
    await db.commit()

    # Return with participant eagerly loaded so response serialization can access
    # account.name (property) without triggering async lazy-load outside greenlet.
    stmt = select(Account).where(Account.id == account.id).options(selectinload(Account.participant))
    account_with_participant = await db.scalar(stmt)
    if not account_with_participant:
        raise NotFoundError("Account not found after registration")
    return account_with_participant


async def authenticate_account(db: AsyncSession, username: str, password: str) -> Account:
    """Verify credentials and return the Account."""
    account = await db.scalar(select(Account).where(Account.username == username.lower()))
    if not account or not verify_password(password, account.hashed_password):
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    if not account.is_active:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    return account


async def get_account_by_id(db: AsyncSession, account_id: UUID) -> Account | None:
    from sqlalchemy.orm import selectinload
    stmt = select(Account).where(Account.id == account_id).options(selectinload(Account.participant))
    return await db.scalar(stmt)


async def update_profile(
    db: AsyncSession,
    account: Account,
    username: str | None = None,
    email: str | None = None,
    name: str | None = None,
    bio: str | None = None,
    avatar_url: str | None = None,
    current_password: str | None = None,
    new_password: str | None = None,
) -> Account:
    """Update account profile, credentials, and linked participant name."""
    if username is not None and username != account.username:
        exists = await db.scalar(select(Account).where(Account.username == username, Account.id != account.id))
        if exists:
            raise ConflictError("Username already taken")
        account.username = username
        # Also update linked participant username
        participant = await db.scalar(select(Participant).where(Participant.account_id == account.id))
        if participant:
            participant.username = username

    if email is not None and email != account.email:
        exists = await db.scalar(select(Account).where(Account.email == email, Account.id != account.id))
        if exists:
            raise ConflictError("Email already registered")
        account.email = email

    if new_password is not None:
        if not current_password:
            raise UnprocessableError("Current password is required to change password")
        if not verify_password(current_password, account.hashed_password):
            raise UnprocessableError("Current password is incorrect")
        account.hashed_password = hash_password(new_password)

    if bio is not None:
        account.bio = bio
    if avatar_url is not None:
        account.avatar_url = avatar_url
    
    if name is not None:
        # Update linked participant name
        participant = await db.scalar(select(Participant).where(Participant.account_id == account.id))
        if participant:
            participant.name = name

    await db.commit()
    await db.refresh(account)
    return account


async def delete_account(db: AsyncSession, account: Account) -> None:
    """Permanently delete an account and its owned agents."""
    from app.models.agent import Agent
    from app.services.agent_service import delete_agent
    
    # 1. Delete all agents (which renames their participants to "Deleted Agent")
    owned_agents = await db.scalars(select(Agent).where(Agent.owner_id == account.id))
    for agent in owned_agents.all():
        await delete_agent(db, agent, account)
    
    # 2. Clean up human participant
    participant = await db.scalar(select(Participant).where(Participant.account_id == account.id))
    if participant:
        participant.name = "Deleted User"
        participant.account_id = None
        
    # 3. Final delete
    await db.delete(account)
    await db.commit()
