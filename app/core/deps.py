"""FastAPI dependency injection utilities."""

from typing import AsyncGenerator
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import AsyncSessionLocal
from app.models.account import Account
from app.services.account_service import get_account_by_id

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def get_current_account(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Account:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "human":
            raise credentials_exc
        account_id: str = payload.get("sub")
        if not account_id:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    account = await get_account_by_id(db, UUID(account_id))
    if account is None:
        raise credentials_exc
    return account
