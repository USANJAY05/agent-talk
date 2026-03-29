"""JWT creation/verification and password hashing utilities."""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

import bcrypt

def hash_password(plain: str) -> str:
    # Ensure password string is bytes and explicitly truncated to 72 bytes to prevent bcrypt 4.x ValueError
    password_bytes = plain.encode('utf-8')[:72]
    hashed_bytes = bcrypt.hashpw(password_bytes, bcrypt.gensalt())
    return hashed_bytes.decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    password_bytes = plain.encode('utf-8')[:72]
    hashed_bytes = hashed.encode('utf-8')
    try:
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except ValueError:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """Create a JWT for a human user."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire, "type": "human", **(extra or {})}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_agent_token(agent_id: str, jti: str) -> str:
    """Create a persistent JWT for an agent.

    Agent tokens do NOT carry a JWT-level expiry because the DB token record
    (identified by `jti`) is the sole revocation mechanism. This mirrors how
    OpenClaw's Telegram botToken works: valid until explicitly revoked via
    DELETE /api/v1/agents/{id}/tokens or replaced by generate_agent_token().

    If a JWT expiry were encoded here, a token renewed by setup.mjs and then
    not used for > AGENT_TOKEN_EXPIRE_MINUTES (e.g. while OpenClaw is offline)
    would be cryptographically invalid even though the DB record is still active,
    causing a spurious 401 on the next reconnect.
    """
    payload = {
        "sub": agent_id,
        "type": "agent",
        "jti": jti,          # JWT ID — used as the revocation nonce in the DB
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises JWTError on failure."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
