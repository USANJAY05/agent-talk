from __future__ import annotations

import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "agent_talk.sqlite3"
STATIC_DIR = BASE_DIR / "frontend"

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    role: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(20), default="#4f46e5")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    messages: Mapped[list["Message"]] = relationship(back_populates="room", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    sender_type: Mapped[str] = mapped_column(String(20))
    sender_id: Mapped[str] = mapped_column(String(50))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    room: Mapped[Room] = relationship(back_populates="messages")


AGENT_SEEDS = [
    {"id": "orchestrator", "name": "Orchestrator", "role": "Keeps the room coordinated", "color": "#0f766e"},
    {"id": "admin", "name": "Admin", "role": "Ops, config, deployments", "color": "#dc2626"},
    {"id": "developer", "name": "Developer", "role": "Builds product and fixes bugs", "color": "#2563eb"},
    {"id": "research", "name": "Research", "role": "Finds facts, compares options", "color": "#7c3aed"},
    {"id": "reviewer", "name": "Reviewer", "role": "Challenges decisions and tests assumptions", "color": "#ea580c"},
]

DEFAULT_ROOM_NAME = "Mission Control"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class AgentOut(BaseModel):
    id: str
    name: str
    role: str
    color: str


class RoomOut(BaseModel):
    id: int
    name: str
    created_at: datetime


class MessageCreate(BaseModel):
    sender_type: Literal["user", "agent"] = "user"
    sender_id: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=4000)


class MessageOut(BaseModel):
    id: int
    room_id: int
    sender_type: str
    sender_id: str
    content: str
    created_at: datetime


class SimulateRequest(BaseModel):
    turns: int = Field(default=3, ge=1, le=12)


app = FastAPI(title="Agent Talk", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        existing = {agent.id for agent in db.scalars(select(Agent)).all()}
        for seed in AGENT_SEEDS:
            if seed["id"] not in existing:
                db.add(Agent(**seed))
        room = db.scalar(select(Room).where(Room.name == DEFAULT_ROOM_NAME))
        if room is None:
            room = Room(name=DEFAULT_ROOM_NAME)
            db.add(room)
            db.flush()
            db.add(
                Message(
                    room_id=room.id,
                    sender_type="agent",
                    sender_id="orchestrator",
                    content="Room is live. Bring the agents in.",
                )
            )
        db.commit()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/agents", response_model=list[AgentOut])
def list_agents(db: Session = Depends(get_db)):
    return db.scalars(select(Agent).order_by(Agent.name)).all()


@app.get("/api/rooms", response_model=list[RoomOut])
def list_rooms(db: Session = Depends(get_db)):
    return db.scalars(select(Room).order_by(Room.created_at.desc())).all()


class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


@app.post("/api/rooms", response_model=RoomOut)
def create_room(payload: RoomCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(Room).where(Room.name == payload.name.strip()))
    if existing:
        return existing
    room = Room(name=payload.name.strip())
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


@app.get("/api/rooms/{room_id}/messages", response_model=list[MessageOut])
def list_messages(room_id: int, db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return db.scalars(select(Message).where(Message.room_id == room_id).order_by(Message.created_at.asc(), Message.id.asc())).all()


@app.post("/api/rooms/{room_id}/messages", response_model=MessageOut)
def create_message(room_id: int, payload: MessageCreate, db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if payload.sender_type == "agent" and db.get(Agent, payload.sender_id) is None:
        raise HTTPException(status_code=400, detail="Unknown agent")

    message = Message(room_id=room_id, sender_type=payload.sender_type, sender_id=payload.sender_id, content=payload.content.strip())
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


@app.post("/api/rooms/{room_id}/simulate", response_model=list[MessageOut])
def simulate_room(room_id: int, payload: SimulateRequest, db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    agents = db.scalars(select(Agent).order_by(Agent.name)).all()
    if len(agents) < 2:
        raise HTTPException(status_code=400, detail="Need at least two agents")

    latest_messages = db.scalars(
        select(Message).where(Message.room_id == room_id).order_by(Message.created_at.desc(), Message.id.desc()).limit(8)
    ).all()
    context = list(reversed(latest_messages))

    created: list[Message] = []
    for _ in range(payload.turns):
        speaker = random.choice(agents)
        reply = generate_agent_reply(speaker, agents, context)
        message = Message(room_id=room_id, sender_type="agent", sender_id=speaker.id, content=reply)
        db.add(message)
        db.flush()
        created.append(message)
        context.append(message)
        context = context[-8:]

    db.commit()
    for message in created:
        db.refresh(message)
    return created


@app.get("/", include_in_schema=False)
def root() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def generate_agent_reply(speaker: Agent, agents: list[Agent], context: list[Message]) -> str:
    last = context[-1].content if context else ""
    peers = [agent for agent in agents if agent.id != speaker.id]
    target = random.choice(peers)

    lower = last.lower()
    if any(word in lower for word in ["bug", "error", "fix", "issue"]):
        ideas = [
            f"@{target.id} I see a failure pattern. I want logs, a repro case, and a rollback plan before we touch prod.",
            f"I’m mapping the problem edges. @{target.id}, can you confirm whether this is app logic or infra drift?",
        ]
    elif any(word in lower for word in ["design", "ui", "frontend", "screen"]):
        ideas = [
            f"The interface needs fewer competing actions. @{target.id}, keep the main path obvious and collapse the rest.",
            f"I’d simplify this into one primary action, one context panel, and live room updates.",
        ]
    elif any(word in lower for word in ["deploy", "ship", "release", "prod"]):
        ideas = [
            f"Before release, I want a migration check, smoke test, and visible rollback steps in the room.",
            f"Shipping is fine, but only if @{target.id} signs off on health checks and database safety.",
        ]
    else:
        ideas = [
            f"@{target.id} Here’s my take: keep the room transparent, make sender identity obvious, and let humans jump in anytime.",
            f"I’m tracking the thread. The useful move now is to turn this into a small concrete task list and assign ownership.",
            f"We should preserve context in the timeline so nobody asks the same question twice.",
            f"I want the user visible in the same room as the agents, not hidden behind separate channels.",
        ]
    return f"[{speaker.name}] {random.choice(ideas)}"
