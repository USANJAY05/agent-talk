"""Inbound webhook endpoints for external integrations."""

from __future__ import annotations

import secrets
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.core.config import settings
from app.core.exceptions import ForbiddenError
from app.db.redis import chat_channel, publish
from app.db.session import AsyncSessionLocal
from app.models.agent import Agent
from app.models.chat import Chat, ChatMember, ChatType
from app.models.participant import Participant, ParticipantType
from app.services.chat_service import assert_member
from app.services.message_service import get_chat_participant_ids, resolve_mentions, save_message
from app.websocket.manager import manager


router = APIRouter()


class WebhookMessageIn(BaseModel):
    sender_participant_id: str = Field(..., description="Participant UUID that will be used as sender")
    content: str = Field(..., min_length=1)
    type: str = Field(default="text")
    attachment_url: str | None = None
    ref: str | None = None


@router.post("/chats/{chat_id}/messages")
async def receive_chat_message_webhook(
    chat_id: str,
    payload: WebhookMessageIn,
    x_webhook_secret: str | None = Header(default=None),
):
    """Accept webhook messages and fan out through the same real-time channels as chat WS."""
    if not x_webhook_secret or not secrets.compare_digest(x_webhook_secret, settings.WEBHOOK_SECRET):
        raise ForbiddenError("Invalid webhook secret")

    async with AsyncSessionLocal() as db:
        chat_uuid = UUID(chat_id)
        sender_uuid = UUID(payload.sender_participant_id)

        sender = await db.get(Participant, sender_uuid)
        if not sender:
            raise ForbiddenError("Sender participant not found")

        await assert_member(db, chat_uuid, sender_uuid)

        from app.schemas.chat import MessageCreate

        msg = await save_message(
            db,
            chat_uuid,
            sender_uuid,
            MessageCreate(
                content=payload.content,
                type=payload.type,
                attachment_url=payload.attachment_url,
            ),
        )

        mentioned = await resolve_mentions(db, msg.content)
        mention_ids = [str(m.id) for m in mentioned]

        broadcast_payload = {
            "event": "message_received",
            "message_id": str(msg.id),
            "chat_id": chat_id,
            "sender_id": str(sender.id),
            "sender_name": sender.name,
            "sender_type": sender.type.value,
            "content": msg.content,
            "type": msg.type.value,
            "attachment_url": msg.attachment_url,
            "created_at": msg.created_at.isoformat(),
            "mentions": mention_ids,
            "ref": payload.ref,
        }
        await publish(chat_channel(chat_id), broadcast_payload)

        member_ids = await get_chat_participant_ids(db, chat_uuid)
        for member_id in member_ids:
            member_id_str = str(member_id)
            if member_id_str == str(sender.id):
                continue
            await publish(
                f"user_notify:{member_id_str}",
                {
                    "event": "message_received",
                    "chat_id": chat_id,
                    "sender_id": str(sender.id),
                    "sender_name": sender.name,
                    "content": msg.content,
                    "type": msg.type.value,
                    "created_at": msg.created_at.isoformat(),
                },
            )

        chat_obj = await db.get(Chat, chat_uuid)
        agent_participants = await db.scalars(
            select(Participant)
            .join(ChatMember, ChatMember.participant_id == Participant.id)
            .where(and_(ChatMember.chat_id == chat_uuid, Participant.type == ParticipantType.agent))
        )

        trigger_ids = set(mention_ids)
        for ap in agent_participants:
            if str(ap.id) == str(sender.id):
                continue
            agent = await db.scalar(select(Agent).where(Agent.participant_id == ap.id))
            if not agent:
                continue

            if str(ap.id) in trigger_ids or (chat_obj and chat_obj.type == ChatType.direct) or agent.passive_listen:
                trigger_ids.add(str(ap.id))

        for tid in trigger_ids:
            trigger_event = {
                "event": "mention_triggered",
                "message_id": str(msg.id),
                "chat_id": chat_id,
                "sender_id": str(sender.id),
                "content": msg.content,
                "created_at": msg.created_at.isoformat(),
                "ref": payload.ref,
            }
            sent = await manager.send_to_agent(tid, trigger_event)
            if not sent:
                await manager.send_to_participant_in_chat(chat_id, tid, trigger_event)

    return {"status": "accepted", "message_id": str(msg.id), "chat_id": chat_id}
