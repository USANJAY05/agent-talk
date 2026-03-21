from __future__ import annotations
import asyncio
import contextlib
import secrets
from typing import Any
from pathlib import Path
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker, Session

from backend.models.database import (
    Base, Account, Room, Message, RoomMembership, AttentionEvent,
    AccountOut, SessionOut, SignupRequest, LoginRequest, UpdateProfile,
    VisibilityUpdate, WhitelistCreate, InviteOut, InviteCreate, RoomCreate, RoomOut,
    MessageCreate, MessageOut, AttentionEventOut, AgentInvite, AuthSession, EventEnvelope
)

from backend.utils.helpers import (
    hash_password, normalize_id, account_out, room_out, message_out,
    owner_account, ensure_member, ensure_owner_in_room, member_ids_for_room,
    create_attention_events, get_account_for_token, can_access_agent
)

from backend.utils.sockets import RoomWebSocketHub, AccountWebSocketHub

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path("/tmp/agent-talk.sqlite3")
STATIC_DIR = BASE_DIR / "frontend" / "dist"

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

ws_hub = RoomWebSocketHub()
events_hub = AccountWebSocketHub()

MAIN_LOOP: asyncio.AbstractEventLoop | None = None

app = FastAPI(title="Agent Talk", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_account(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Account:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = authorization.removeprefix("Bearer ").strip()
    account = get_account_for_token(db, token)
    if not account:
        raise HTTPException(status_code=401, detail="Invalid session")
    return account

def build_event_envelope(
    *,
    event_type: str,
    event_scope: str,
    room_id: int | None = None,
    account_ids: list[str] | None = None,
    actor_account_id: str | None = None,
    room: RoomOut | None = None,
    message: MessageOut | None = None,
    attention: list[AttentionEventOut] | None = None,
) -> dict[str, Any]:
    return EventEnvelope(
        type=event_type,
        event_scope=event_scope,
        room_id=room_id,
        account_ids=account_ids or [],
        actor_account_id=actor_account_id,
        room=room,
        message=message,
        attention=attention or [],
    ).model_dump()

async def broadcast_room_event(db: Session, room_id: int, payload: dict[str, Any], account_ids: list[str] | None = None) -> None:
    targets = account_ids if account_ids is not None else member_ids_for_room(db, room_id)
    allowed_account_ids = set(targets)
    await ws_hub.broadcast(room_id, payload, allowed_account_ids=allowed_account_ids)
    await events_hub.broadcast_many(targets, payload)

async def broadcast_attention_events(account_ids: list[str], payload: dict[str, Any]) -> None:
    await events_hub.broadcast_many(account_ids, payload)

def reset_legacy_db_if_needed() -> None:
    if not DB_PATH.exists():
        return
    with engine.connect() as conn:
        room_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(rooms)")}
        account_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(accounts)")}
    if (room_columns and ("room_type" not in room_columns or "created_by" not in room_columns or "logo_url" not in room_columns)) or (account_columns and ("username" not in account_columns or "logo_url" not in account_columns)):
        DB_PATH.unlink(missing_ok=True)

@app.on_event("startup")
async def startup() -> None:
    global MAIN_LOOP
    reset_legacy_db_if_needed()
    Base.metadata.create_all(bind=engine)
    MAIN_LOOP = asyncio.get_running_loop()

# -- API Routes --

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/signup", response_model=SessionOut)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    username = normalize_id(payload.username)
    name = payload.name.strip()
    if not username or not name:
        raise HTTPException(status_code=400, detail="Name and username are required")
    if db.scalar(select(Account).where(Account.username == username)):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    account_id = normalize_id(name)
    base_id = account_id
    i = 2
    while db.get(Account, account_id):
        account_id = f"{base_id}-{i}"
        i += 1

    is_first_account = db.scalar(select(Account.id).limit(1)) is None
    is_super_owner = is_first_account
    normalized_role = payload.role.strip()
    if is_super_owner:
        normalized_role = "Super Owner"
    elif payload.account_type == "human" and not normalized_role:
        normalized_role = "Owner"

    assigned_owner = payload.owner_id
    assigned_public = payload.is_public
    if payload.account_type == "agent" and payload.invite_token:
        invite = db.get(AgentInvite, payload.invite_token.strip())
        if invite and not invite.used:
            assigned_owner = invite.owner_id
            assigned_public = False
            invite.used = True
            db.add(invite)

    account = Account(
        id=account_id,
        name=name,
        username=username,
        password_hash=hash_password(payload.password),
        account_type=payload.account_type,
        role=normalized_role,
        color=payload.color.strip(),
        is_owner=is_super_owner,
        owner_id=assigned_owner,
        is_public=assigned_public,
        is_active=True if payload.account_type == "human" else (not bool(payload.invite_token)), # Agents from link start inactive
    )
    db.add(account)
    db.flush()

    if is_super_owner:
        room = Room(name="Mission Control", room_type="group", created_by=account.id)
        db.add(room)
        db.flush()
        ensure_member(db, room.id, account.id)
    else:
        owner = owner_account(db)
        if owner:
            room = db.scalar(select(Room).where(Room.name == "Mission Control"))
            if room:
                ensure_member(db, room.id, account.id)

    token = secrets.token_urlsafe(32)
    from backend.models.database import AuthSession
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
    from backend.models.database import AuthSession
    db.add(AuthSession(token=token, account_id=account.id))
    db.commit()
    return SessionOut(token=token, account=account_out(account))

@app.get("/api/me", response_model=AccountOut)
def me(current: Account = Depends(get_current_account)):
    return account_out(current)

@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    from sqlalchemy import select
    accounts = db.scalars(select(Account).order_by(Account.is_owner.desc(), Account.name.asc())).all()
    if not current.is_owner:
        accounts = [a for a in accounts if a.account_type != "agent" or can_access_agent(db, a, current)]
    return [account_out(a) for a in accounts]

@app.get("/api/agents", response_model=list[AccountOut])
def list_agents(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    agents = db.scalars(select(Account).where(Account.account_type == "agent").order_by(Account.name.asc())).all()
    if not current.is_owner:
        agents = [a for a in agents if can_access_agent(db, a, current)]
    return [account_out(a) for a in agents]

@app.get("/api/rooms", response_model=list[RoomOut])
def list_rooms(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    memberships = db.scalars(select(RoomMembership).where(RoomMembership.account_id == current.id).order_by(RoomMembership.joined_at.desc())).all()
    return [room_out(m.room) for m in memberships]

@app.post("/api/rooms", response_model=RoomOut)
async def create_room(payload: RoomCreate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if payload.room_type == "direct":
        if len(payload.member_ids) != 1:
            raise HTTPException(status_code=400, detail="Direct chat needs exactly one other member")
        other = db.get(Account, payload.member_ids[0])
        if not other:
            raise HTTPException(status_code=404, detail="Account not found")
        if other.account_type == "agent" and not can_access_agent(db, other, current):
            raise HTTPException(status_code=403, detail="This agent is private")
        if other.account_type == "agent" and not other.is_active:
            raise HTTPException(status_code=403, detail="This agent is pending approval")
        
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
            raise HTTPException(status_code=400, detail="Group name required")
        room = Room(name=name, room_type="group", created_by=current.id, logo_url=payload.logo_url)
        db.add(room)
        db.flush()
        ensure_member(db, room.id, current.id)
        ensure_owner_in_room(db, room.id)
        for mid in payload.member_ids:
            m = db.get(Account, mid)
            if m and m.account_type == "agent" and not m.is_active:
                continue # Skip unapproved agents
            ensure_member(db, room.id, mid)

    db.commit()
    db.refresh(room)
    res = room_out(room)
    await broadcast_room_event(
        db,
        room.id,
        build_event_envelope(
            event_type="room.created",
            event_scope="room",
            room_id=room.id,
            account_ids=member_ids_for_room(db, room.id),
            actor_account_id=current.id,
            room=res,
        ),
    )
    return res

@app.get("/api/rooms/{room_id}/messages", response_model=list[MessageOut])
def room_messages(room_id: int, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Forbidden")
    messages = db.scalars(select(Message).where(Message.room_id == room_id).order_by(Message.created_at.asc())).all()
    return [message_out(m) for m in messages]

@app.get("/api/rooms/{room_id}/members", response_model=list[AccountOut])
def room_members(room_id: int, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Forbidden")
    memberships = db.scalars(select(RoomMembership).where(RoomMembership.room_id == room_id)).all()
    return [account_out(m.account) for m in memberships]

@app.post("/api/rooms/{room_id}/messages", response_model=MessageOut)
async def create_message(room_id: int, payload: MessageCreate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == current.id)):
        raise HTTPException(status_code=403, detail="Forbidden")
    msg = Message(room_id=room_id, account_id=current.id, content=payload.content.strip())
    db.add(msg)
    db.flush()
    create_attention_events(db, room_id, current.id, msg.id, msg.content)
    db.commit()
    db.refresh(msg)
    res = message_out(msg)
    room_member_ids = member_ids_for_room(db, room_id)
    attention_targets = [account_id for account_id in room_member_ids if account_id != current.id]
    attention_events = attention_feed(current, db)
    del attention_events  # sender feed is irrelevant; keep explicit for clarity

    await broadcast_room_event(
        db,
        room_id,
        build_event_envelope(
            event_type="message.created",
            event_scope="room",
            room_id=room_id,
            account_ids=room_member_ids,
            actor_account_id=current.id,
            message=res,
        ),
    )

    if attention_targets:
        target_attention: list[AttentionEventOut] = []
        for account_id in attention_targets:
            events = db.scalars(
                select(AttentionEvent)
                .where(
                    AttentionEvent.account_id == account_id,
                    AttentionEvent.room_id == room_id,
                    AttentionEvent.message_id == msg.id,
                    AttentionEvent.consumed == False,
                )
                .order_by(AttentionEvent.created_at.asc())
            ).all()
            if not events:
                continue
            target_attention = [AttentionEventOut.model_validate(event) for event in events]
            await broadcast_attention_events(
                [account_id],
                build_event_envelope(
                    event_type="attention.created",
                    event_scope="account",
                    room_id=room_id,
                    account_ids=[account_id],
                    actor_account_id=current.id,
                    message=res,
                    attention=target_attention,
                ),
            )
    return res

@app.get("/api/agent-invites", response_model=list[InviteOut])
def list_invites(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    from sqlalchemy import select
    invites = db.scalars(select(AgentInvite).where(AgentInvite.owner_id == current.id).order_by(AgentInvite.created_at.desc())).all()
    return [InviteOut(token=i.token, used=i.used, name=i.name) for i in invites]

@app.post("/api/agent-invites", response_model=InviteOut)
def create_invite(payload: InviteCreate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    # Generate a fresh unique token every time (BotFather style)
    token = secrets.token_urlsafe(24)
    invite = AgentInvite(token=token, owner_id=current.id, name=payload.name)
    db.add(invite)
    db.commit()
    return InviteOut(token=token, used=False, name=invite.name)

@app.delete("/api/agent-invites/{token}")
def delete_invite(token: str, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    invite = db.get(AgentInvite, token)
    if not invite or (invite.owner_id != current.id and not current.is_owner):
        raise HTTPException(status_code=403, detail="Forbidden")
    db.delete(invite)
    db.commit()
    return {"status": "ok"}

@app.put("/api/accounts/{account_id}/visibility", response_model=AccountOut)
def update_visibility(account_id: str, payload: VisibilityUpdate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if not acc or (acc.id != current.id and acc.owner_id != current.id and not current.is_owner):
        raise HTTPException(status_code=403, detail="Forbidden")
    acc.is_public = payload.is_public
    db.commit()
    db.refresh(acc)
    return account_out(acc)

@app.post("/api/accounts/{account_id}/whitelist")
def add_whitelist(account_id: str, payload: WhitelistCreate, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    agent = db.get(Account, account_id)
    if not agent or (agent.owner_id != current.id and not current.is_owner):
        raise HTTPException(status_code=403, detail="Forbidden")
    from backend.models.database import AgentWhitelist
    db.add(AgentWhitelist(agent_id=agent.id, account_id=payload.account_id))
    db.commit()
    return {"status": "ok"}

@app.put("/api/accounts/{account_id}/logo", response_model=AccountOut)
def update_logo(account_id: str, payload: UpdateProfile, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if not acc or (acc.id != current.id and not current.is_owner):
        raise HTTPException(status_code=403, detail="Forbidden")
    acc.logo_url = payload.logo_url.strip() or None
    db.commit()
    db.refresh(acc)
    return account_out(acc)

@app.put("/api/rooms/{room_id}/logo", response_model=RoomOut)
def update_room_logo(room_id: int, payload: UpdateProfile, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.created_by != current.id and not current.is_owner:
        raise HTTPException(status_code=403, detail="Forbidden")
    room.logo_url = payload.logo_url.strip() or None
    db.commit()
    db.refresh(room)
    return room_out(room)

@app.get("/api/accounts/{account_id}/shared_groups", response_model=list[RoomOut])
def shared_groups(account_id: str, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    memberships = db.scalars(select(RoomMembership).where(RoomMembership.account_id == current.id)).all()
    shared: list[RoomOut] = []
    for membership in memberships:
        room = membership.room
        if room.room_type != "group":
            continue
        has_other = db.scalar(select(RoomMembership).where(RoomMembership.room_id == room.id, RoomMembership.account_id == account_id))
        if has_other:
            shared.append(room_out(room))
    return shared

@app.put("/api/accounts/{account_id}/activate", response_model=AccountOut)
def activate_account(account_id: str, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if not acc or (acc.owner_id != current.id and not current.is_owner):
        raise HTTPException(status_code=403, detail="Forbidden")
    acc.is_active = True
    db.commit()
    db.refresh(acc)
    return account_out(acc)

# -- Internal / MCP logic --

def search_messages(query: str, current: Account, db: Session) -> list[dict[str, Any]]:
    my_rooms = db.scalars(select(RoomMembership.room_id).where(RoomMembership.account_id == current.id)).all()
    if not my_rooms: return []
    results = db.scalars(
        select(Message)
        .where(Message.room_id.in_(my_rooms), Message.content.ilike(f"%{query}%"))
        .order_by(Message.created_at.desc())
        .limit(50)
    ).all()
    return [message_out(m).model_dump() for m in results]

def attention_feed(current: Account, db: Session) -> list[AttentionEventOut]:
    events = db.scalars(
        select(AttentionEvent)
        .where(AttentionEvent.account_id == current.id, AttentionEvent.consumed == False)
        .order_by(AttentionEvent.created_at.desc())
        .limit(50)
    ).all()
    return [AttentionEventOut.model_validate(e) for e in events]

def ack_attention(event_id: int, current: Account, db: Session) -> dict[str, Any]:
    event = db.get(AttentionEvent, event_id)
    if not event or event.account_id != current.id:
        raise HTTPException(status_code=404, detail="Event not found")
    event.consumed = True
    db.commit()
    return {"status": "ok"}

@app.get("/api/attention", response_model=list[AttentionEventOut])
def list_attention(current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    return attention_feed(current, db)

@app.post("/api/attention/{event_id}/ack")
def acknowledge_attention(event_id: int, current: Account = Depends(get_current_account), db: Session = Depends(get_db)):
    return ack_attention(event_id, current, db)

# -- WebSockets --

@app.websocket("/ws/rooms/{room_id}")
async def room_socket(websocket: WebSocket, room_id: int):
    token = websocket.query_params.get("token", "")
    db = SessionLocal()
    acc = get_account_for_token(db, token)
    if not acc:
        await websocket.close(code=4401)
        return
    if not db.scalar(select(RoomMembership).where(RoomMembership.room_id == room_id, RoomMembership.account_id == acc.id)):
        await websocket.close(code=4403)
        return
    db.close()
    await ws_hub.connect(room_id, acc.id, websocket)
    try:
        while True: await websocket.receive_text()
    except: pass
    finally: ws_hub.disconnect(room_id, websocket)

@app.websocket("/ws/events")
async def event_socket(websocket: WebSocket):
    token = websocket.query_params.get("token", "")
    db = SessionLocal()
    acc = get_account_for_token(db, token)
    if not acc:
        await websocket.close(code=4403)
        return
    db.close()
    await events_hub.connect(acc.id, websocket)
    try:
        while True: await websocket.receive_text()
    except: pass
    finally: events_hub.disconnect(acc.id, websocket)

@app.get("/", include_in_schema=False)
def root():
    return FileResponse(STATIC_DIR / "index.html")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
