"""
/ws/owner/notifications — Real-time notification stream for agent owners.

Owners connect here to receive live events:
  - connection_request_received  (new request via invite link)
  - (extensible for future owner-facing events)

Connect:  ws://host/ws/owner/notifications?token=<human-jwt>

No messages need to be sent by the client — this is receive-only.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.redis import subscribe
from app.db.session import AsyncSessionLocal
from app.services.account_service import get_account_by_id
from app.services.agent_service import list_owned_agents

from uuid import UUID

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/owner/notifications")
async def owner_notifications(
    websocket: WebSocket,
    token: str = Query(..., description="Human JWT"),
):
    """
    Real-time notification stream for agent owners.

    **Connect:** `ws://host/ws/owner/notifications?token=<jwt>`

    **Receive events:**
    ```json
    {
      "event": "connection_request_received",
      "request_id": "uuid",
      "agent_id": "uuid",
      "requester_name": "my-prod-bot",
      "requester_description": "Our production summarisation agent",
      "requester_contact": "devops@company.com",
      "created_at": "2024-01-01T00:00:00Z"
    }
    ```
    """
    await websocket.accept()

    # Authenticate
    try:
        payload = decode_token(token)
        if payload.get("type") != "human":
            raise ValueError("Not a human token")
        account_id = UUID(payload["sub"])
    except (JWTError, ValueError, KeyError) as e:
        await websocket.send_text(json.dumps({"event": "error", "detail": str(e)}))
        await websocket.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        account = await get_account_by_id(db, account_id)
        if not account:
            await websocket.send_text(json.dumps({"event": "error", "detail": "Account not found"}))
            await websocket.close(code=4001)
            return

        from app.services.participant_service import get_participant_by_account
        participant = await get_participant_by_account(db, account)
        p_id = str(participant.id)

        owned_agents = await list_owned_agents(db, account_id)
        agent_ids = [str(a.id) for a in owned_agents]

    if not agent_ids:
        await websocket.send_text(json.dumps({
            "event": "info",
            "detail": "You have no agents. Create one to start receiving notifications."
        }))

    await websocket.send_text(json.dumps({
        "event": "subscribed",
        "watching_agents": agent_ids,
        "message": f"Listening for events on {len(agent_ids)} agent(s)."
    }))

    # Subscribe to all owned agent channels concurrently
    async def listen_agent(agent_id: str):
        channel = f"agent_owner:{agent_id}"
        try:
            async for event in subscribe(channel):
                try:
                    await websocket.send_text(json.dumps(event))
                except Exception:
                    return
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("Notification listener error agent=%s: %s", agent_id, exc)

    async def listen_user(pid: str):
        channel = f"user_notify:{pid}"
        try:
            async for event in subscribe(channel):
                try:
                    await websocket.send_text(json.dumps(event))
                except Exception:
                    return
        except asyncio.CancelledError:
            pass

    tasks = [asyncio.create_task(listen_agent(aid)) for aid in agent_ids]
    tasks.append(asyncio.create_task(listen_user(p_id)))

    try:
        # Keep alive — owner doesn't send anything, just receives
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_text(json.dumps({"event": "ping"}))
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Owner WS error: %s", exc)
    finally:
        for t in tasks:
            t.cancel()
        logger.info("Owner WS disconnected account=%s", account_id)
