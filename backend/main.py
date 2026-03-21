from __future__ import annotations

import asyncio
import contextlib
import hashlib
import secrets
import threading
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "agent_talk.sqlite3"
STATIC_DIR = BASE_DIR / "frontend" / "dist"

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    account_type: Mapped[str] = mapped_column(String(20))
    role: Mapped[str] = mapped_column(String(120))
    color: Mapped[str] = mapped_column(String(20), default="#4f46e5")
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    account: Mapped[Account] = relationship()


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    room_type: Mapped[str] = mapped_column(String(20), default="group")
    created_by: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    memberships: Mapped[list["RoomMembership"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship(back_populates="room", cascade="all, delete-orphan")


class RoomMembership(Base):
    __tablename__ = "room_memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    room: Mapped[Room] = relationship(back_populates="memberships")
    account: Mapped[Account] = relationship()


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    room: Mapped[Room] = relationship(back_populates="messages")
    account: Mapped[Account] = relationship()


class AttentionEvent(Base):
    __tablename__ = "attention_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), default="message.created")
    preview: Mapped[str] = mapped_column(String(500), default="")
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    account: Mapped[Account] = relationship()


class AccountOut(BaseModel):
    id: str
    name: str
    username: str
    account_type: str
    role: str
    color: str
    is_owner: bool


class SessionOut(BaseModel):
    token: str
    account: AccountOut


class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=100)
    account_type: Literal["human", "agent"] = "human"
    role: str = Field(..., min_length=1, max_length=120)
    color: str = Field(default="#4f46e5", min_length=4, max_length=20)


class LoginRequest(BaseModel):
    username: str
    password: str


class RoomCreate(BaseModel):
    name: str = Field(default="", max_length=120)
    room_type: Literal["group", "direct"] = "group"
    member_ids: list[str] = Field(default_factory=list)


class RoomOut(BaseModel):
    id: int
    name: str
    room_type: str
    created_by: str
    created_at: datetime


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


class MessageOut(BaseModel):
    id: int
    room_id: int
    account_id: str
    account_name: str
    account_type: str
    is_owner: bool
    color: str
    content: str
    created_at: datetime


class AttentionEventOut(BaseModel):
    id: int
    account_id: str
    room_id: int
    message_id: int | None
    event_type: str
    preview: str
    consumed: bool
    created_at: datetime


app = FastAPI(title="Agent Talk", version="0.3.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


MAIN_LOOP: asyncio.AbstractEventLoop | None = None


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


ws_hub = RoomWebSocketHub()
events_hub = AccountWebSocketHub()


def dispatch(coro) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        if MAIN_LOOP is None or MAIN_LOOP.is_closed():
            return
        asyncio.run_coroutine_threadsafe(coro, MAIN_LOOP)
        return
    loop.create_task(coro)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def normalize_id(value: str) -> str:
    return "-".join(value.strip().lower().split())


def account_out(account: Account) -> AccountOut:
    return AccountOut(
        id=account.id,
        name=account.name,
        username=account.username,
        account_type=account.account_type,
        role=account.role,
        color=account.color,
        is_owner=account.is_owner,
    )


def room_out(room: Room) -> RoomOut:
    return RoomOut(id=room.id, name=room.name, room_type=room.room_type, created_by=room.created_by, created_at=room.created_at)


def message_out(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        room_id=message.room_id,
        account_id=message.account_id,
        account_name=message.account.name,
        account_type=message.account.account_type,
        is_owner=message.account.is_owner,
        color=message.account.color,
        content=message.content,
        created_at=message.created_at,
    )


def owner_account(db: Session) -> Account | None:
    return db.scalar(select(Account).where(Account.is_owner.is_(True)))


def ensure_member(db: Session, room_id: int, account_id: str) -> None:
    exists = db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == account_id))
    if not exists:
        db.add(RoomMembership(room_id=room_id, account_id=account_id))
        db.flush()


def ensure_owner_in_room(db: Session, room_id: int) -> None:
    owner = owner_account(db)
    if owner:
        ensure_member(db, room_id, owner.id)


def member_ids_for_room(db: Session, room_id: int) -> list[str]:
    return list(db.scalars(select(RoomMembership.account_id).where(RoomMembership.room_id == room_id)).all())


async def broadcast_room_event(db: Session, room_id: int, payload: dict[str, Any], account_ids: list[str] | None = None) -> None:
    targets = account_ids if account_ids is not None else member_ids_for_room(db, room_id)
    allowed_account_ids = set(targets)
    await ws_hub.broadcast(room_id, payload, allowed_account_ids=allowed_account_ids)
    await events_hub.broadcast_many(targets, payload)


def create_attention_events(db: Session, room_id: int, sender_id: str, message_id: int | None, preview: str, event_type: str = "message.created") -> None:
    members = db.scalars(select(RoomMembership).where(RoomMembership.room_id == room_id)).all()
    for membership in members:
        if membership.account_id == sender_id:
            continue
        db.add(
            AttentionEvent(
                account_id=membership.account_id,
                room_id=room_id,
                message_id=message_id,
                event_type=event_type,
                preview=preview[:500],
            )
        )


def get_account_for_token(db: Session, token: str) -> Account | None:
    normalized = token.strip()
    if not normalized:
        return None
    auth = db.scalar(select(AuthSession).where(AuthSession.token == normalized))
    return auth.account if auth else None


def get_current_account(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Account:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = authorization.removeprefix("Bearer ").strip()
    account = get_account_for_token(db, token)
    if not account:
        raise HTTPException(status_code=401, detail="Invalid session")
    return account


def reset_legacy_db_if_needed() -> None:
    if not DB_PATH.exists():
        return
    with engine.connect() as conn:
        room_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(rooms)")}
        account_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(accounts)")}
    if (room_columns and ("room_type" not in room_columns or "created_by" not in room_columns)) or (account_columns and "username" not in account_columns):
        DB_PATH.unlink(missing_ok=True)


@app.on_event("startup")
async def startup() -> None:
    global MAIN_LOOP
    reset_legacy_db_if_needed()
    Base.metadata.create_all(bind=engine)
    MAIN_LOOP = asyncio.get_running_loop()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/signup", response_model=SessionOut)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    username = normalize_id(payload.username)
    name = payload.name.strip()
    if not username or not name:
        raise HTTPException(status_code=400, detail="Name and username are required")
    if db.scalar(select(Account).where(Account.username == username)):
        raise HTTPException(status_code=400, detail="Username already exists")
    if db.scalar(select(Account).where(Account.name == name)):
        raise HTTPException(status_code=400, detail="Display name already exists")

    account_id = normalize_id(name)
    base_id = account_id
    i = 2
    while db.get(Account, account_id):
        account_id = f"{base_id}-{i}"
        i += 1

    is_first_account = db.scalar(select(Account.id).limit(1)) is None
    is_owner = is_first_account
    normalized_role = payload.role.strip()
    if is_owner:
        normalized_role = "Owner"

    account = Account(
        id=account_id,
        name=name,
        username=username,
        password_hash=hash_password(payload.password),
        account_type=payload.account_type,
        role=normalized_role,
        color=payload.color.strip(),
        is_owner=is_owner,
    )
    db.add(account)
    db.flush()

    if is_owner:
        room = Room(name="Mission Control", room_type="group", created_by=account.id)
        db.add(room)
        db.flush()
        ensure_member(db, room.id, account.id)
        db.add(Message(room_id=room.id, account_id=account.id, content="Mission Control is live."))
    else:
        owner = owner_account(db)
        if owner:
            room = db.scalar(select(Room).where(Room.name == "Mission Control"))
            if room:
                ensure_member(db, room.id, account.id)

    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token=token, account_id=account.id))
    db.commit()
    db.refresh(account)
    return SessionOut(token=token, account=account_out(account))


@app.post("/api/login", response_model=SessionOut)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username = normalize_id(payload.username)
    account = db.scalar(select(Account).where(Account.username == username))
    if not account or account.password_hash != hash_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token=token, account_id=account.id))
    db.commit()
    return SessionOut(token=token, account=account_out(account))


@app.get("/api/me", response_model=AccountOut)
def me(current: Account = Depends(get_current_account)):
    return account_out(current)


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    accounts = db.scalars(select(Account).order_by(Account.is_owner.desc(), Account.name.asc())).all()
    return [account_out(a) for a in accounts]


@app.get("/api/agents", response_model=list[AccountOut])
def list_agents(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    agents = db.scalars(select(Account).where(Account.account_type == "agent").order_by(Account.name.asc())).all()
    return [account_out(a) for a in agents]


@app.get("/api/rooms", response_model=list[RoomOut])
def list_rooms(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    memberships = db.scalars(select(RoomMembership).where(RoomMembership.account_id == current.id).order_by(RoomMembership.joined_at.desc())).all()
    rooms = [m.room for m in memberships]
    return [room_out(r) for r in rooms]


@app.post("/api/rooms", response_model=RoomOut)
async def create_room(payload: RoomCreate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if payload.room_type == "direct":
        if len(payload.member_ids) != 1:
            raise HTTPException(status_code=400, detail="Direct chat needs exactly one other member")
        other = db.get(Account, payload.member_ids[0])
        if not other:
            raise HTTPException(status_code=404, detail="Account not found")
        owner = owner_account(db)
        ids = sorted({current.id, other.id, *([owner.id] if owner else [])})
        direct_name = "DM: " + " / ".join(ids)
        existing = db.scalar(select(Room).where(Room.name == direct_name))
        if existing:
            return room_out(existing)
        room = Room(name=direct_name, room_type="direct", created_by=current.id)
        db.add(room)
        db.flush()
        for member_id in ids:
            ensure_member(db, room.id, member_id)
    else:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Group name is required")
        room = Room(name=name, room_type="group", created_by=current.id)
        db.add(room)
        db.flush()
        ensure_member(db, room.id, current.id)
        ensure_owner_in_room(db, room.id)
        for member_id in payload.member_ids:
            member = db.get(Account, member_id)
            if member:
                ensure_member(db, room.id, member.id)
    create_attention_events(db, room.id, current.id, None, f"New {room.room_type} room created: {room.name}", event_type="room.created")
    db.commit()
    db.refresh(room)
    created_room = room_out(room)
    await broadcast_room_event(db, room.id, {"type": "room.created", "room": created_room.model_dump()})
    return created_room


@app.get("/api/rooms/{room_id}/members", response_model=list[AccountOut])
def room_members(room_id: int, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Not in this room")
    members = db.scalars(select(RoomMembership).where(RoomMembership.room_id == room_id).order_by(RoomMembership.joined_at.asc())).all()
    return [account_out(m.account) for m in members]


@app.post("/api/rooms/{room_id}/members/{account_id}")
async def add_room_member(room_id: int, account_id: str, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Not in this room")
    member = db.get(Account, account_id)
    if not member:
        raise HTTPException(status_code=404, detail="Account not found")
    ensure_member(db, room_id, account_id)
    ensure_owner_in_room(db, room_id)
    create_attention_events(db, room_id, current.id, None, f"{member.name} was added to room {room.name}", event_type="room.member_added")
    db.commit()
    payload = {"type": "room.member_added", "room_id": room_id, "account_id": member.id, "account_name": member.name}
    await broadcast_room_event(db, room_id, payload)
    return {"status": "ok"}


@app.get("/api/rooms/{room_id}/messages", response_model=list[MessageOut])
def room_messages(room_id: int, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Not in this room")
    messages = db.scalars(select(Message).where(Message.room_id == room_id).order_by(Message.created_at.asc(), Message.id.asc())).all()
    return [message_out(m) for m in messages]


@app.post("/api/rooms/{room_id}/messages", response_model=MessageOut)
async def create_message(room_id: int, payload: MessageCreate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Not in this room")
    ensure_owner_in_room(db, room_id)
    message = Message(room_id=room_id, account_id=current.id, content=payload.content.strip())
    db.add(message)
    db.flush()
    create_attention_events(db, room_id, current.id, message.id, message.content)
    db.commit()
    db.refresh(message)
    created_message = message_out(message)
    await broadcast_room_event(db, room_id, {"type": "message.created", "room_id": room_id, "message": created_message.model_dump()})
    return created_message


@app.get("/api/search")
def search_messages(query: str, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    memberships = db.scalars(select(RoomMembership).where(RoomMembership.account_id == current.id)).all()
    room_ids = [m.room_id for m in memberships]
    if not room_ids:
        return []
    messages = db.scalars(select(Message).where(Message.room_id.in_(room_ids)).order_by(Message.created_at.desc())).all()
    q = query.strip().lower()
    filtered = [m for m in messages if q in m.content.lower() or q in m.account.name.lower() or q in m.room.name.lower()]
    return [message_out(m).model_dump() for m in filtered[:50]]


@app.get("/api/attention", response_model=list[AttentionEventOut])
def attention_feed(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    events = db.scalars(
        select(AttentionEvent)
        .where(AttentionEvent.account_id == current.id, AttentionEvent.consumed.is_(False))
        .order_by(AttentionEvent.created_at.asc(), AttentionEvent.id.asc())
    ).all()
    return [AttentionEventOut.model_validate({
        "id": e.id,
        "account_id": e.account_id,
        "room_id": e.room_id,
        "message_id": e.message_id,
        "event_type": e.event_type,
        "preview": e.preview,
        "consumed": e.consumed,
        "created_at": e.created_at,
    }) for e in events]


@app.post("/api/attention/{event_id}/ack")
def ack_attention(event_id: int, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    event = db.get(AttentionEvent, event_id)
    if not event or event.account_id != current.id:
        raise HTTPException(status_code=404, detail="Event not found")
    event.consumed = True
    db.commit()
    return {"status": "ok"}


@app.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: int):
    token = websocket.query_params.get("token", "")
    if not token.strip():
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    account_id: str | None = None
    try:
        account = get_account_for_token(db, token)
        if not account:
            await websocket.close(code=4401)
            return
        account_id = account.id

        room = db.get(Room, room_id)
        if not room:
            await websocket.close(code=4404)
            return

        allowed = db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == account_id))
        if not allowed:
            await websocket.close(code=4403)
            return
    finally:
        db.close()

    await ws_hub.connect(room_id, account_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        ws_hub.disconnect(room_id, websocket)


@app.websocket("/ws/events")
async def event_socket(websocket: WebSocket):
    token = websocket.query_params.get("token", "")
    if not token.strip():
        await websocket.close(code=4401)
        return
    db = SessionLocal()
    account_id: str | None = None
    try:
        account = get_account_for_token(db, token)
        if not account:
            await websocket.close(code=4401)
            return
        account_id = account.id
    finally:
        db.close()

    await events_hub.connect(account_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        events_hub.disconnect(account_id, websocket)


@app.get("/", include_in_schema=False)
def root() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
