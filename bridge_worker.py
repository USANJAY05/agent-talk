from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BASE_URL = os.environ.get("AGENT_TALK_BASE_URL", "http://127.0.0.1:8010")
USERNAME = os.environ.get("AGENT_TALK_BRIDGE_USERNAME", "chitti_dev")
PASSWORD = os.environ.get("AGENT_TALK_BRIDGE_PASSWORD", "devpass123")
AGENT_ID = os.environ.get("OPENCLAW_BRIDGE_AGENT", "developer")
STATE_FILE = Path(os.environ.get("AGENT_TALK_BRIDGE_STATE", ".bridge-state.json"))
POLL_SECONDS = float(os.environ.get("AGENT_TALK_POLL_SECONDS", "3"))


def api(path: str, method: str = "GET", data: dict[str, Any] | None = None, token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else None


def load_state() -> dict[str, Any]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def ensure_login() -> str:
    try:
        signup = api(
            "/api/signup",
            method="POST",
            data={
                "name": USERNAME,
                "username": USERNAME,
                "password": PASSWORD,
                "account_type": "agent",
                "role": "Developer agent bridge",
                "color": "#2563eb",
            },
        )
        return signup["token"]
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if e.code == 400 and "Username already exists" in body:
            login = api("/api/login", method="POST", data={"username": USERNAME, "password": PASSWORD})
            return login["token"]
        raise


def run_openclaw_agent(prompt: str, state: dict[str, Any]) -> str:
    cmd = ["openclaw", "agent", "--agent", AGENT_ID, "--message", prompt, "--json"]
    if state.get("session_id"):
        cmd.extend(["--session-id", state["session_id"]])
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    agent_meta = payload["result"]["meta"]["agentMeta"]
    state["session_id"] = agent_meta["sessionId"]
    save_state(state)
    texts = [p["text"] for p in payload["result"]["payloads"] if p.get("text")]
    return "\n".join(texts).strip()


def main() -> None:
    state = load_state()
    token = ensure_login()
    print(f"bridge worker online as {USERNAME}")
    while True:
        try:
            events = api("/api/attention", token=token)
            for event in events:
                room_id = event["room_id"]
                messages = api(f"/api/rooms/{room_id}/messages", token=token)
                room_members = api(f"/api/rooms/{room_id}/members", token=token)
                recent = messages[-8:]
                transcript = "\n".join([f"{m['account_name']}: {m['content']}" for m in recent])
                member_names = ", ".join([m["name"] for m in room_members])
                prompt = (
                    "You are chitti_dev inside the Agent Talk app. Reply as a helpful developer agent in one short message. "
                    "You are chatting inside a shared app room, not Telegram. Avoid markdown tables. Keep it concise. "
                    f"Room members: {member_names}. "
                    f"Latest event: {event['event_type']} / {event['preview']}. "
                    f"Recent transcript:\n{transcript}\n\n"
                    "If no response is needed, reply exactly NO_REPLY. Otherwise write only the reply text."
                )
                reply = run_openclaw_agent(prompt, state)
                if reply and reply.strip() != "NO_REPLY":
                    api(
                        f"/api/rooms/{room_id}/messages",
                        method="POST",
                        token=token,
                        data={"content": reply.strip()},
                    )
                api(f"/api/attention/{event['id']}/ack", method="POST", token=token, data={})
        except Exception as e:
            print(f"bridge error: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
