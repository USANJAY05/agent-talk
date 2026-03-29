"""Participant schemas."""

from uuid import UUID
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models.participant import ParticipantType


class ParticipantUpdate(BaseModel):
    name: str | None = None
    username: str | None = None
    bio: str | None = None
    tags: list[str] | None = None
    metadata_: dict[str, Any] | None = None


class ParticipantOut(BaseModel):
    id: UUID
    type: ParticipantType
    name: str
    username: str | None = None
    email: str | None = None
    bio: str | None = None
    metadata_: dict[str, Any]
    tags: list[str] = []
    account_id: UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
