"""
In-process WebSocket connection registry.

Each chat room keeps a set of active WebSocket connections.
For multi-instance deployments the Redis pub/sub layer bridges between instances.
"""

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Thread-safe registry of active WebSocket connections per chat."""

    def __init__(self):
        # chat_id → {participant_id: WebSocket}
        self._chat_connections: dict[str, dict[str, WebSocket]] = defaultdict(dict)
        # agent participant_id → WebSocket  (for the agent channel)
        self._agent_connections: dict[str, WebSocket] = {}
        # owner participant_id → WebSocket (for user notification channel)
        self._owner_connections: dict[str, WebSocket] = {}
        # count of active connections per participant_id across all types
        self._participant_counts: dict[str, int] = defaultdict(int)
        self._lock = asyncio.Lock()

    # ── Chat connections ──────────────────────────────────────────────────────

    async def connect_chat(self, chat_id: str, participant_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._chat_connections[chat_id][participant_id] = ws
            self._participant_counts[participant_id] += 1
        logger.info("WS connect  chat=%s participant=%s", chat_id, participant_id)

    async def disconnect_chat(self, chat_id: str, participant_id: str) -> None:
        async with self._lock:
            self._chat_connections[chat_id].pop(participant_id, None)
            if not self._chat_connections[chat_id]:
                del self._chat_connections[chat_id]
            if participant_id in self._participant_counts:
                self._participant_counts[participant_id] -= 1
                if self._participant_counts[participant_id] <= 0:
                    del self._participant_counts[participant_id]
        logger.info("WS disconnect  chat=%s participant=%s", chat_id, participant_id)

    async def broadcast_to_chat(self, chat_id: str, payload: dict[str, Any]) -> None:
        """Send payload to all locally-connected participants in a chat."""
        data = json.dumps(payload)
        dead: list[tuple[str, str]] = []
        connections = dict(self._chat_connections.get(chat_id, {}))
        for pid, ws in connections.items():
            try:
                await ws.send_text(data)
            except Exception:
                dead.append((chat_id, pid))
        for cid, pid in dead:
            await self.disconnect_chat(cid, pid)

    async def send_to_participant_in_chat(
        self, chat_id: str, participant_id: str, payload: dict[str, Any]
    ) -> bool:
        """Send a payload to a specific participant in a specific chat. Returns True if sent."""
        ws = self._chat_connections.get(chat_id, {}).get(participant_id)
        if ws:
            try:
                await ws.send_text(json.dumps(payload))
                return True
            except Exception:
                await self.disconnect_chat(chat_id, participant_id)
        return False

    # ── Agent connections ─────────────────────────────────────────────────────

    async def connect_agent(self, participant_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._agent_connections[participant_id] = ws
            self._participant_counts[participant_id] += 1
        logger.info("Agent WS connect  participant=%s", participant_id)

    async def disconnect_agent(self, participant_id: str) -> None:
        async with self._lock:
            self._agent_connections.pop(participant_id, None)
            if participant_id in self._participant_counts:
                self._participant_counts[participant_id] -= 1
                if self._participant_counts[participant_id] <= 0:
                    del self._participant_counts[participant_id]
        logger.info("Agent WS disconnect  participant=%s", participant_id)

    async def send_to_agent(self, participant_id: str, payload: dict[str, Any]) -> bool:
        ws = self._agent_connections.get(participant_id)
        if ws:
            try:
                await ws.send_text(json.dumps(payload))
                return True
            except Exception:
                await self.disconnect_agent(participant_id)
        return False

    async def connect_owner(self, participant_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._owner_connections[participant_id] = ws
            self._participant_counts[participant_id] += 1
        logger.info("Owner WS connect  participant=%s", participant_id)

    async def disconnect_owner(self, participant_id: str) -> None:
        async with self._lock:
            self._owner_connections.pop(participant_id, None)
            if participant_id in self._participant_counts:
                self._participant_counts[participant_id] -= 1
                if self._participant_counts[participant_id] <= 0:
                    del self._participant_counts[participant_id]
        logger.info("Owner WS disconnect  participant=%s", participant_id)

    def is_participant_online(self, participant_id: str) -> bool:
        """True if the participant has ANY active connection on this instance."""
        return self._participant_counts.get(participant_id, 0) > 0


# Singleton instance shared across all routers in this process
manager = ConnectionManager()
