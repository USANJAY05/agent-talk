from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP
from sqlalchemy import select

from backend.main import (
    Account,
    AccountOut,
    AttentionEvent,
    AttentionEventOut,
    AuthSession,
    LoginRequest,
    Message,
    MessageCreate,
    RoomCreate,
    RoomMembership,
    SessionLocal,
    SignupRequest,
    ack_attention,
    attention_feed,
    create_message,
    create_room,
    get_current_account,
    hash_password,
    login,
    message_out,
    normalize_id,
    search_messages,
    signup,
)

mcp = FastMCP("agent-talk")


def _session_from_token(token: str):
    db = SessionLocal()
    try:
        auth = db.scalar(select(AuthSession).where(AuthSession.token == token))
        if not auth:
            raise ValueError("invalid token")
        return auth.account.id
    finally:
        db.close()


@mcp.tool()
def signup_tool(name: str, username: str, password: str, account_type: str = "human", role: str = "member", color: str = "#4f46e5") -> dict[str, Any]:
    db = SessionLocal()
    try:
        result = signup(SignupRequest(name=name, username=username, password=password, account_type=account_type, role=role, color=color), db)
        return result.model_dump()
    finally:
        db.close()


@mcp.tool()
def login_tool(username: str, password: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        result = login(LoginRequest(username=username, password=password), db)
        return result.model_dump()
    finally:
        db.close()


@mcp.tool()
def list_agents_tool(token: str) -> list[dict[str, Any]]:
    db = SessionLocal()
    try:
        account_id = _session_from_token(token)
        _ = db.get(Account, account_id)
        agents = db.scalars(select(Account).where(Account.account_type == "agent").order_by(Account.name.asc())).all()
        return [AccountOut.model_validate(a).model_dump() for a in agents]
    finally:
        db.close()


@mcp.tool()
def create_group_tool(token: str, name: str, member_ids: list[str] | None = None) -> dict[str, Any]:
    db = SessionLocal()
    try:
        auth = token
        current = get_current_account(f"Bearer {auth}", db)
        result = create_room(RoomCreate(name=name, room_type="group", member_ids=member_ids or []), current, db)
        return result.model_dump()
    finally:
        db.close()


@mcp.tool()
def create_direct_tool(token: str, other_account_id: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        current = get_current_account(f"Bearer {token}", db)
        result = create_room(RoomCreate(name="", room_type="direct", member_ids=[other_account_id]), current, db)
        return result.model_dump()
    finally:
        db.close()


@mcp.tool()
def chat_tool(token: str, room_id: int, content: str) -> dict[str, Any]:
    db = SessionLocal()
    try:
        current = get_current_account(f"Bearer {token}", db)
        result = create_message(room_id, MessageCreate(content=content), current, db)
        return result.model_dump()
    finally:
        db.close()


@mcp.tool()
def search_tool(token: str, query: str) -> list[dict[str, Any]]:
    db = SessionLocal()
    try:
        current = get_current_account(f"Bearer {token}", db)
        return search_messages(query, current, db)
    finally:
        db.close()


@mcp.tool()
def poll_attention_tool(token: str) -> list[dict[str, Any]]:
    db = SessionLocal()
    try:
        current = get_current_account(f"Bearer {token}", db)
        events = attention_feed(current, db)
        return [e.model_dump() for e in events]
    finally:
        db.close()


@mcp.tool()
def ack_attention_tool(token: str, event_id: int) -> dict[str, Any]:
    db = SessionLocal()
    try:
        current = get_current_account(f"Bearer {token}", db)
        return ack_attention(event_id, current, db)
    finally:
        db.close()


if __name__ == "__main__":
    mcp.run()
