"""
/ws/agent/connect — Agent connection endpoint.

The agent WebSocket protocol:
  1. Connect to ws://host/ws/agent/connect
    2. Send handshake: {"token": "<agent token>"}
    3. Server validates token, marks session active
    4. On first connect, agent must send set_identity before chatting
    5. Agent can later update identity via update_identity
    6. Agent can send: send_message | typing_event | stream_start | stream_chunk | stream_end
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.redis import agent_channel, chat_channel, publish, subscribe
from app.db.session import AsyncSessionLocal
from app.schemas.websocket import AgentHandshake
from app.services.agent_service import consume_agent_token
from app.models.agent import AgentToken
from app.services.chat_service import assert_member, list_chats_for_participant
from app.services.message_service import resolve_mentions, save_message
from app.services.participant_service import get_participant
from app.websocket.manager import manager

router = APIRouter()
logger = logging.getLogger(__name__)


def _identity_ready(agent, participant) -> bool:
    meta = participant.metadata_ or {}
    explicit = meta.get("identity_initialized")
    if isinstance(explicit, bool):
        return explicit

    # Backward-compatible fallback for older records.
    if participant.username or agent.agent_username:
        return True
    if participant.bio or (agent.description and not str(agent.description).lower().startswith("auto agent")):
        return True
    return False


@router.websocket("/ws/agent/connect")
async def agent_websocket(websocket: WebSocket):
    await websocket.accept()

    # Handshake
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
        handshake_data = json.loads(raw)
        token_str = handshake_data.get("token", "")
    except (asyncio.TimeoutError, json.JSONDecodeError, KeyError):
        await websocket.send_text(json.dumps({"event": "error", "detail": "Handshake timeout or malformed"}))
        await websocket.close(code=4002)
        return

    from app.core.security import decode_token
    from jose import JWTError

    try:
        payload = decode_token(token_str)
        jti = payload.get("jti")
        token_agent_id = payload.get("sub")
        if not jti: raise ValueError("Token missing jti")
    except (JWTError, ValueError) as e:
        await websocket.send_text(json.dumps({"event": "error", "detail": str(e)}))
        await websocket.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        try:
            agent = await consume_agent_token(db, jti, token_agent_id=token_agent_id)
            token_record = await db.scalar(select(AgentToken).where(AgentToken.jti == jti))
            if not token_record:
                raise ValueError("Token record not found")
        except Exception as e:
            await websocket.send_text(json.dumps({"event": "error", "detail": str(e)}))
            await websocket.close(code=4001)
            return

        participant_id_str = str(agent.participant_id)
        participant = await get_participant(db, agent.participant_id)

        if agent.owner_presence:
            try:
                from app.services.chat_service import _ensure_owner_in_chat
                existing_chats = await list_chats_for_participant(db, agent.participant_id)
                for chat in existing_chats:
                    await _ensure_owner_in_chat(db, chat.id, agent.participant_id)
                if existing_chats: await db.commit()
            except Exception as exc:
                logger.warning("Owner presence sync failed for agent %s: %s", agent.id, exc)

    # Register
    await manager.connect_agent(participant_id_str, websocket)
    is_paired = bool(token_record.is_paired)
    pairing_code = token_record.pairing_code
    identity_ready = _identity_ready(agent, participant)

    await websocket.send_text(json.dumps({
        "event": "connected", "agent_id": str(agent.id), "participant_id": participant_id_str,
        "message": "Agent session established.",
    }))
    if not is_paired:
        await websocket.send_text(json.dumps({
            "event": "pairing_required",
            "pairing_code": pairing_code,
            "detail": "Submit this code from your OpenClaw setup via confirm_pairing before chatting.",
        }))
    if not identity_ready:
        await websocket.send_text(json.dumps({
            "event": "identity_required",
            "detail": "Submit agent identity via set_identity before chatting.",
        }))
    logger.info("Agent connected agent=%s participant=%s", agent.id, participant_id_str)

    async def redis_listener():
        try:
            async for event in subscribe(agent_channel(participant_id_str)):
                try: await websocket.send_text(json.dumps(event))
                except Exception: break
        except asyncio.CancelledError: pass

    listener_task = asyncio.create_task(redis_listener())

    try:
        while True:
            raw = await websocket.receive_text()
            try: data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"event": "error", "detail": "Malformed JSON"}))
                continue

            event = data.get("event")

            if event == "confirm_pairing":
                submitted = str(data.get("code", "")).strip()
                if not submitted:
                    await websocket.send_text(json.dumps({"event": "error", "detail": "Pairing code is required"}))
                    continue

                if submitted != pairing_code:
                    await websocket.send_text(json.dumps({"event": "error", "detail": "Invalid pairing code"}))
                    continue

                if not is_paired:
                    async with AsyncSessionLocal() as db:
                        rec = await db.scalar(select(AgentToken).where(AgentToken.jti == jti))
                        if rec:
                            rec.is_paired = True
                            rec.paired_at = datetime.now(timezone.utc)
                            await db.commit()
                    is_paired = True

                await websocket.send_text(json.dumps({"event": "pairing_confirmed", "detail": "Pairing successful"}))
                continue

            if event in {"set_identity", "update_identity"}:
                identity_payload = data.get("identity") if isinstance(data.get("identity"), dict) else data
                raw_name = identity_payload.get("name")
                raw_username = identity_payload.get("username")
                raw_description = identity_payload.get("description")
                raw_metadata = identity_payload.get("metadata")

                name = str(raw_name).strip() if raw_name is not None else None
                username = str(raw_username).strip() if raw_username is not None else None
                description = str(raw_description).strip() if raw_description is not None else None
                metadata = raw_metadata if isinstance(raw_metadata, dict) else {}

                if event == "set_identity" and not identity_ready and not name:
                    await websocket.send_text(json.dumps({"event": "error", "detail": "Identity name is required on first setup"}))
                    continue

                async with AsyncSessionLocal() as db:
                    from app.models.agent import Agent
                    from app.models.participant import Participant

                    db_agent = await db.get(Agent, agent.id)
                    db_participant = await db.get(Participant, agent.participant_id)
                    if not db_agent or not db_participant:
                        await websocket.send_text(json.dumps({"event": "error", "detail": "Agent identity record not found"}))
                        continue

                    if name:
                        db_participant.name = name
                        db_agent.name = name
                    if raw_username is not None:
                        val = username or None
                        db_participant.username = val
                        db_agent.agent_username = val
                    if raw_description is not None:
                        val = description or None
                        db_participant.bio = val
                        db_agent.description = val

                    merged_meta = {**(db_participant.metadata_ or {}), **metadata, "identity_initialized": True}
                    db_participant.metadata_ = merged_meta
                    if db_agent.is_placeholder and name:
                        db_agent.is_placeholder = False

                    await db.commit()
                    await db.refresh(db_agent)
                    await db.refresh(db_participant)

                    agent = db_agent
                    participant = db_participant

                identity_ready = True
                await websocket.send_text(json.dumps({
                    "event": "identity_updated",
                    "identity": {
                        "name": participant.name,
                        "username": participant.username,
                        "description": participant.bio,
                    },
                }))
                continue

            if not is_paired:
                await websocket.send_text(json.dumps({
                    "event": "error",
                    "detail": "Pairing required. Send event=confirm_pairing with the pairing code first.",
                }))
                continue

            if not identity_ready:
                await websocket.send_text(json.dumps({
                    "event": "error",
                    "detail": "Identity required. Send event=set_identity with name/username/description first.",
                }))
                continue

            if event == "send_message":
                chat_id = data.get("chat_id")
                if not chat_id: continue
                async with AsyncSessionLocal() as db:
                    try: await assert_member(db, UUID(chat_id), agent.participant_id)
                    except Exception: continue
                    from app.schemas.chat import MessageCreate
                    msg = await save_message(
                        db, UUID(chat_id), agent.participant_id,
                        MessageCreate(content=data.get("content", ""), type=data.get("type", "text")),
                    )
                    mentioned = await resolve_mentions(db, msg.content)
                    mention_ids = [str(m.id) for m in mentioned]
                    await publish(chat_channel(chat_id), {
                        "event": "message_received", "message_id": str(msg.id), "chat_id": chat_id,
                        "sender_id": participant_id_str, "sender_name": participant.name, "sender_type": "agent",
                        "content": msg.content, "type": msg.type.value, "created_at": msg.created_at.isoformat(),
                        "mentions": mention_ids,
                    })
                await websocket.send_text(json.dumps({"event": "ack", "ref": data.get("ref")}))

            elif event == "typing_event":
                chat_id = data.get("chat_id")
                if chat_id:
                    await publish(chat_channel(chat_id), {
                        "event": "typing_event", "participant_id": participant_id_str,
                        "participant_name": participant.name, "is_typing": bool(data.get("is_typing", False)),
                    })

            elif event == "stream_start":
                chat_id = data.get("chat_id")
                stream_id = data.get("stream_id") or str(uuid.uuid4())
                if chat_id:
                    await publish(chat_channel(chat_id), {
                        "event": "message_received", "stream_id": stream_id, "is_streaming": True,
                        "chat_id": chat_id, "sender_id": participant_id_str, "sender_name": participant.name,
                        "sender_type": "agent", "content": "", "type": "text", "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                    await websocket.send_text(json.dumps({"event": "ack", "stream_id": stream_id, "ref": data.get("ref")}))

            elif event == "stream_chunk":
                chat_id = data.get("chat_id")
                stream_id = data.get("stream_id")
                if chat_id and stream_id:
                    await publish(chat_channel(chat_id), {
                        "event": "stream_chunk", "stream_id": stream_id, "chat_id": chat_id, "content": data.get("content", ""),
                    })

            elif event == "stream_end":
                chat_id = data.get("chat_id")
                stream_id = data.get("stream_id")
                if chat_id and stream_id:
                    async with AsyncSessionLocal() as db:
                        from app.schemas.chat import MessageCreate
                        msg = await save_message(db, UUID(chat_id), agent.participant_id, MessageCreate(content=data.get("content", ""), type="text"))
                        await publish(chat_channel(chat_id), {
                            "event": "message_received", "message_id": str(msg.id), "stream_id": stream_id,
                            "is_streaming": False, "chat_id": chat_id, "sender_id": participant_id_str,
                            "sender_name": participant.name, "sender_type": "agent", "content": msg.content,
                            "type": "text", "created_at": msg.created_at.isoformat(),
                        })
                    await websocket.send_text(json.dumps({"event": "ack", "ref": data.get("ref")}))

            else:
                await websocket.send_text(json.dumps({"event": "error", "detail": f"Unknown event: {event}"}))

    except WebSocketDisconnect: pass
    except Exception as exc: logger.error("Agent WS error: %s", exc, exc_info=True)
    finally:
        listener_task.cancel()
        await manager.disconnect_agent(participant_id_str)
