"""Auth request/response schemas."""

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    username: str
    name: str | None = None
    email: EmailStr
    password: str
    bio: str | None = None

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("username must be alphanumeric (underscores/hyphens allowed)")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("username must be 3-50 characters")
        return v.lower()

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProfileUpdateRequest(BaseModel):
    username: str | None = None
    email: EmailStr | None = None
    name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    current_password: str | None = None
    new_password: str | None = None

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("username must be alphanumeric (underscores/hyphens allowed)")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("username must be 3-50 characters")
        return v.lower()

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if len(v) < 8:
            raise ValueError("new_password must be at least 8 characters")
        return v
    
from uuid import UUID

class AccountOut(BaseModel):
    id: UUID
    username: str
    email: str
    avatar_url: str | None
    bio: str | None
    name: str | None = None

    model_config = {"from_attributes": True}
