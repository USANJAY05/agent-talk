import asyncio
import contextlib
import threading
from collections import defaultdict
from typing import Any
from dataclasses import dataclass
from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

@dataclass(frozen=True)
class RoomSocketConnection:
    websocket: WebSocket
    account_id: str

@dataclass(frozen=True)
class AccountSocketConnection:
    websocket: WebSocket

class RoomWebSocketHub:
    def __init__(self) -> None:
        self.connections: dict[int, set[RoomSocketConnection]] = defaultdict(set)
        self._lock = threading.RLock()

    async def connect(self, room_id: int, account_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        with self._lock:
            self.connections[room_id].add(RoomSocketConnection(websocket=websocket, account_id=account_id))

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        with self._lock:
            sockets = self.connections.get(room_id)
            if not sockets:
                return
            remaining = {connection for connection in sockets if connection.websocket is not websocket}
            if remaining:
                self.connections[room_id] = remaining
            else:
                self.connections.pop(room_id, None)

    async def broadcast(self, room_id: int, payload: dict[str, Any], *, allowed_account_ids: set[str] | None = None) -> None:
        with self._lock:
            sockets = list(self.connections.get(room_id, set()))
        stale: list[WebSocket] = []
        encoded_payload = jsonable_encoder(payload)
        for connection in sockets:
            if allowed_account_ids is not None and connection.account_id not in allowed_account_ids:
                continue
            try:
                await connection.websocket.send_json(encoded_payload)
            except Exception:
                stale.append(connection.websocket)
        for websocket in stale:
            self.disconnect(room_id, websocket)
            with contextlib.suppress(Exception):
                await websocket.close()

class AccountWebSocketHub:
    def __init__(self) -> None:
        self.connections: dict[str, set[AccountSocketConnection]] = defaultdict(set)
        self._lock = threading.RLock()

    async def connect(self, account_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        with self._lock:
            self.connections[account_id].add(AccountSocketConnection(websocket=websocket))

    def disconnect(self, account_id: str, websocket: WebSocket) -> None:
        with self._lock:
            sockets = self.connections.get(account_id)
            if not sockets:
                return
            remaining = {connection for connection in sockets if connection.websocket is not websocket}
            if remaining:
                self.connections[account_id] = remaining
            else:
                self.connections.pop(account_id, None)

    async def broadcast_many(self, account_ids: list[str], payload: dict[str, Any]) -> None:
        stale: list[tuple[str, WebSocket]] = []
        encoded_payload = jsonable_encoder(payload)
        unique_account_ids = sorted(set(account_ids))
        with self._lock:
            sockets_by_account = {
                account_id: list(self.connections.get(account_id, set()))
                for account_id in unique_account_ids
            }
        for account_id, connections in sockets_by_account.items():
            for connection in connections:
                try:
                    await connection.websocket.send_json(encoded_payload)
                except Exception:
                    stale.append((account_id, connection.websocket))
        for account_id, websocket in stale:
            self.disconnect(account_id, websocket)
            with contextlib.suppress(Exception):
                await websocket.close()
