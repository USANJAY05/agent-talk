"""Authentication endpoints."""

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_account, get_db
from app.core.security import create_access_token
from app.models.account import Account
from app.schemas.auth import AccountOut, RegisterRequest, TokenResponse
from app.services.account_service import authenticate_account, register_account, update_profile

router = APIRouter()


from app.schemas.auth import AccountOut, RegisterRequest, TokenResponse, ProfileUpdateRequest
from app.services.account_service import authenticate_account, register_account, update_profile

@router.post("/register", response_model=AccountOut, status_code=201,
    summary="Register a new human account")
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new account. A Participant record is automatically created and linked.
    """
    account = await register_account(db, data)
    return account


@router.post("/login", response_model=TokenResponse,
    summary="Log in and receive a JWT")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    Standard OAuth2 password flow. Returns a Bearer JWT for use in `Authorization` header.
    """
    account = await authenticate_account(db, form.username, form.password)
    token = create_access_token(str(account.id))
    return TokenResponse(access_token=token)


@router.get("/me", response_model=AccountOut,
    summary="Get the authenticated user's profile")
async def me(account: Account = Depends(get_current_account)):
    return account


@router.patch("/me", response_model=AccountOut,
    summary="Update profile (name, bio, avatar)")
async def update_me(
    data: ProfileUpdateRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    return await update_profile(
        db,
        account,
        username=data.username,
        email=data.email,
        name=data.name,
        bio=data.bio,
        avatar_url=data.avatar_url,
        current_password=data.current_password,
        new_password=data.new_password,
    )


@router.delete("/me", status_code=204,
    summary="Permanently delete your account and all associated data")
async def self_delete(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    """
    Destructive: immediately deletes all your agents, disconnects your chats,
    and removes your account record. History is preserved with 'Deleted User' names.
    """
    from app.services.account_service import delete_account
    await delete_account(db, account)
