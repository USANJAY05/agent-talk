"""
/ws/chat/{chat_id} — Real-time chat WebSocket endpoint.

Flow:
  1. Client connects with JWT in query param  ?token=<jwt>
  2. Server validates token + chat membership
  3. Client can send: send_message | typing_event | stream_start | stream_chunk | stream_end
  4. Server broadcasts via Redis pub/sub (all instances receive it)
  5. Each instance fans out to its locally-connected participants
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.redis import chat_channel, publish, subscribe
from app.db.session import AsyncSessionLocal
from app.models.participant import Participant, ParticipantType
from app.models.chat import Chat, ChatType, ChatMember
from app.models.agent import Agent
from app.schemas.websocket import WSError, WSAck
from app.services.chat_service import assert_member, get_chat
from app.services.message_service import (
    get_chat_participant_ids,
    resolve_mentions,
    save_message,
)
from app.services.participant_service import get_participant_by_account, get_participant
from app.services.account_service import get_account_by_id
from app.websocket.manager import manager

router = APIRouter()
logger = logging.getLogger(__name__)


async def _authenticate_ws(token: str, db: AsyncSession) -> Participant:
    """Decode JWT and return the calling Participant. Raises on failure."""
    try:
        payload = decode_token(token)
    except JWTError:
        raise ValueError("Invalid token")

    token_type = payload.get("type")
    subject = payload.get("sub")
    if not subject:
        raise ValueError("Token missing subject")

    if token_type == "human":
        account = await get_account_by_id(db, UUID(subject))
        if not account:
            raise ValueError("Account not found")
        return await get_participant_by_account(db, account)
    elif token_type == "agent":
        # Agent tokens encode Agent.id in `sub` (not Participant.id).
        # We must look up the Agent first, then return its linked Participant.
        from sqlalchemy import select as _select
        from app.models.agent import Agent as _Agent
        agent = await db.scalar(_select(_Agent).where(_Agent.id == UUID(subject)))
        if not agent:
            raise ValueError("Agent not found")
        return await get_participant(db, agent.participant_id)
    else:
        raise ValueError("Unknown token type")


@router.websocket("/ws/chat/{chat_id}")
async def chat_websocket(
    websocket: WebSocket,
    chat_id: str,
    token: str = Query(..., description="JWT access token"),
):
    async with AsyncSessionLocal() as db:
        try:
            participant = await _authenticate_ws(token, db)
        except ValueError as e:
            await websocket.accept()
            await websocket.send_text(json.dumps({"event": "error", "detail": str(e)}))
            await websocket.close(code=4001)
            return

        try:
            await assert_member(db, UUID(chat_id), participant.id)
        except Exception:
            await websocket.accept()
            await websocket.send_text(json.dumps({"event": "error", "detail": "Not a chat member"}))
            await websocket.close(code=4003)
            return

        participant_id_str = str(participant.id)
        await manager.connect_chat(chat_id, participant_id_str, websocket)

        # Broadcast online status
        await publish(chat_channel(chat_id), {
            "event": "participant_status",
            "participant_id": participant_id_str,
            "status": "online"
        })

    # ── Redis subscriber task ─────────────────────────────────────────────────
    async def redis_listener():
        try:
            async for event in subscribe(chat_channel(chat_id)):
                await manager.broadcast_to_chat(chat_id, event)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("Redis listener error: %s", exc)

    listener_task = asyncio.create_task(redis_listener())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"event": "error", "detail": "Malformed JSON"}))
                continue

            event = data.get("event")

            if event == "send_message":
                async with AsyncSessionLocal() as db:
                    from app.schemas.chat import MessageCreate
                    incoming_content = data.get("content", "")
                    if not isinstance(incoming_content, str):
                        incoming_content = str(incoming_content)

                    msg = await save_message(
                        db, UUID(chat_id), participant.id,
                        MessageCreate(
                            content=incoming_content,
                            type=data.get("type", "text"),
                            attachment_url=data.get("attachment_url"),
                        )
                    )
                    mentioned = await resolve_mentions(db, msg.content)
                    mention_ids = [str(m.id) for m in mentioned]

                    broadcast_payload = {
                        "event": "message_received",
                        "message_id": str(msg.id),
                        "chat_id": chat_id,
                        "sender_id": str(participant.id),
                        "sender_name": participant.name,
                        "sender_type": participant.type.value,
                        "content": msg.content,
                        "type": msg.type.value,
                        "attachment_url": msg.attachment_url,
                        "created_at": msg.created_at.isoformat(),
                        "mentions": mention_ids,
                        "ref": data.get("ref"),
                    }
                    await publish(chat_channel(chat_id), broadcast_payload)

                    # Also push user-level notifications so non-active chats update in real time.
                    member_ids = await get_chat_participant_ids(db, UUID(chat_id))
                    for member_id in member_ids:
                        member_id_str = str(member_id)
                        if member_id_str == participant_id_str:
                            continue
                        await publish(
                            f"user_notify:{member_id_str}",
                            {
                                "event": "message_received",
                                "chat_id": chat_id,
                                "sender_id": str(participant.id),
                                "sender_name": participant.name,
                                "content": msg.content,
                                "type": msg.type.value,
                                "created_at": msg.created_at.isoformat(),
                            },
                        )

                    # Trigger agents
                    chat_obj = await db.get(Chat, UUID(chat_id))
                    agent_participants = await db.scalars(
                        select(Participant)
                        .join(ChatMember, ChatMember.participant_id == Participant.id)
                        .where(and_(ChatMember.chat_id == UUID(chat_id), Participant.type == ParticipantType.agent))
                    )
                    
                    trigger_ids = set(mention_ids)
                    for ap in agent_participants:
                        if str(ap.id) == participant_id_str: continue
                        agent = await db.scalar(select(Agent).where(Agent.participant_id == ap.id))
                        if not agent: continue
                        
                        if str(ap.id) in trigger_ids or chat_obj.type == ChatType.direct or agent.passive_listen:
                            trigger_ids.add(str(ap.id))
                    
                    for tid in trigger_ids:
                        trigger_event = {
                            "event": "mention_triggered",
                            "message_id": str(msg.id),
                            "chat_id": chat_id,
                            "sender_id": str(participant.id),
                            "content": msg.content,
                            "created_at": msg.created_at.isoformat(),
                            "ref": data.get("ref"),
                        }
                        sent = await manager.send_to_agent(tid, trigger_event)
                        if not sent:
                            await manager.send_to_participant_in_chat(chat_id, tid, trigger_event)

                await websocket.send_text(json.dumps({"event": "ack", "ref": data.get("ref")}))

            elif event == "typing_event":
                await publish(chat_channel(chat_id), {
                    "event": "typing_event",
                    "participant_id": str(participant.id),
                    "participant_name": participant.name,
                    "is_typing": bool(data.get("is_typing", False)),
                })

            elif event == "stream_start":
                stream_id = data.get("stream_id") or str(uuid.uuid4())
                await publish(chat_channel(chat_id), {
                    "event": "message_received",
                    "stream_id": stream_id,
                    "is_streaming": True,
                    "chat_id": chat_id,
                    "sender_id": participant_id_str,
                    "sender_name": participant.name,
                    "sender_type": participant.type.value,
                    "content": "",
                    "type": "text",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                await websocket.send_text(json.dumps({"event": "ack", "stream_id": stream_id, "ref": data.get("ref")}))

            elif event == "stream_chunk":
                stream_id = data.get("stream_id")
                if stream_id:
                    await publish(chat_channel(chat_id), {
                        "event": "stream_chunk",
                        "stream_id": stream_id,
                        "chat_id": chat_id,
                        "content": data.get("content", ""),
                    })

            elif event == "stream_end":
                stream_id = data.get("stream_id")
                if stream_id:
                    async with AsyncSessionLocal() as db:
                        from app.schemas.chat import MessageCreate
                        msg = await save_message(
                            db, UUID(chat_id), participant.id,
                            MessageCreate(content=data.get("content", ""), type="text"),
                        )
                        await publish(chat_channel(chat_id), {
                            "event": "message_received",
                            "message_id": str(msg.id),
                            "stream_id": stream_id,
                            "is_streaming": False,
                            "chat_id": chat_id,
                            "sender_id": participant_id_str,
                            "sender_name": participant.name,
                            "sender_type": participant.type.value,
                            "content": msg.content,
                            "type": "text",
                            "created_at": msg.created_at.isoformat(),
                        })

                        # Stream-completed messages should also notify members not in this chat view.
                        member_ids = await get_chat_participant_ids(db, UUID(chat_id))
                        for member_id in member_ids:
                            member_id_str = str(member_id)
                            if member_id_str == participant_id_str:
                                continue
                            await publish(
                                f"user_notify:{member_id_str}",
                                {
                                    "event": "message_received",
                                    "chat_id": chat_id,
                                    "sender_id": participant_id_str,
                                    "sender_name": participant.name,
                                    "content": msg.content,
                                    "type": "text",
                                    "created_at": msg.created_at.isoformat(),
                                },
                            )
                    await websocket.send_text(json.dumps({"event": "ack", "ref": data.get("ref")}))

            else:
                await websocket.send_text(json.dumps({"event": "error", "detail": f"Unknown event: {event}"}))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Chat WS error: %s", exc, exc_info=True)
    finally:
        listener_task.cancel()
        await manager.disconnect_chat(chat_id, participant_id_str)
        await publish(chat_channel(chat_id), {
            "event": "participant_status",
            "participant_id": participant_id_str,
            "status": "offline"
        })
