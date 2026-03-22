from __future__ import annotations

import asyncio
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

import websockets
from websockets.exceptions import ConnectionClosed


class AgentTalkConnector:
    """
    A unified OpenClaw Connector for the Agent Talk chat application.
    
    This connector handles:
    - Signup/Login authentication with Agent Talk
    - Real-time WebSocket event listening
    - Fetching room context and members
    - Dispatching tasks to a local OpenClaw agent
    - Sending responses back to the chat room
    """

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        agent_id: str,
        role: str = "Intelligent Agent Bridge",
        invite_token: str | None = None,
        state_file_path: str = ".bridge-state.json",
        color: str = "#4f46e5"
    ):
        self.base_url = base_url.rstrip("/")
        self.ws_url = self.base_url.replace("http", "ws")
        self.username = username
        self.password = password
        self.agent_id = agent_id
        self.role = role
        self.invite_token = invite_token
        self.state_file = Path(state_file_path)
        self.color = color
        
        self.token: str | None = None
        self.account_id: str | None = None
        self.state = self._load_state()

    def _load_state(self) -> dict[str, Any]:
        if self.state_file.exists():
            try:
                return json.loads(self.state_file.read_text())
            except Exception:
                pass
        return {}

    def _save_state(self) -> None:
        self.state_file.write_text(json.dumps(self.state, indent=2))

    def _api_sync(self, path: str, method: str = "GET", data: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Fallback sync API helper using urllib."""
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
            
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"[AgentTalkConnector] API Error ({e.code}): {body}")
            raise

    def authenticate(self) -> None:
        """Authenticate with the Agent Talk backend."""
        print(f"[*] Authenticating as {self.username}...")
        try:
            # Try signup first (handles invite token)
            session = self._api_sync("/api/signup", method="POST", data={
                "name": self.username,
                "username": self.username,
                "password": self.password,
                "account_type": "agent",
                "role": self.role,
                "color": self.color,
                "invite_token": self.invite_token,
            })
        except urllib.error.HTTPError as e:
            if e.code == 400:  # Likely already exists
                session = self._api_sync("/api/login", method="POST", data={
                    "username": self.username, 
                    "password": self.password
                })
            else:
                raise
                
        if session:
            self.token = session["token"]
            self.account_id = session["account"]["id"]
            print(f"[+] Authenticated successfully! Account ID: {self.account_id}")

    async def run_openclaw_agent(self, prompt: str) -> str:
        """Run the local openclaw agent in a thread-safe way."""
        loop = asyncio.get_event_loop()
        def _run():
            cmd = ["openclaw", "agent", "--agent", self.agent_id, "--message", prompt, "--json"]
            if self.state.get("session_id"):
                cmd.extend(["--session-id", self.state["session_id"]])
            
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                payload = json.loads(result.stdout)
                
                # Update session state
                agent_meta = payload.get("result", {}).get("meta", {}).get("agentMeta", {})
                if agent_meta.get("sessionId"):
                    self.state["session_id"] = agent_meta["sessionId"]
                    self._save_state()
                
                # Extract texts
                texts = [p["text"] for p in payload.get("result", {}).get("payloads", []) if p.get("text")]
                return "\n".join(texts).strip()
            except Exception as e:
                print(f"[!] AI Error: {e}")
                return ""

        return await loop.run_in_executor(None, _run)

    async def handle_attention(self):
        """Fetch pending attention events and reply if needed."""
        try:
            events = self._api_sync("/api/attention")
            if not events: return

            # Group events by room
            rooms: dict[int, list] = {}
            for ev in events:
                rid = ev["room_id"]
                if rid not in rooms: rooms[rid] = []
                rooms[rid].append(ev)

            for room_id, evs in rooms.items():
                messages = self._api_sync(f"/api/rooms/{room_id}/messages")
                members = self._api_sync(f"/api/rooms/{room_id}/members")
                
                # Only reply if the last message wasn't from us
                last_msg = messages[-1] if messages else None
                if last_msg and last_msg["account_id"] == self.account_id:
                    # Just ack the events
                    for ev in evs: self._api_sync(f"/api/attention/{ev['id']}/ack", method="POST")
                    continue

                print(f"[*] Processing room {room_id} (New messages: {len(evs)})")
                
                transcript = "\n".join([f"{m['account_name']}: {m['content']}" for m in messages[-10:]])
                member_names = ", ".join([m["name"] for m in members])
                
                prompt = (
                    f"You are {self.username}, an AI agent in the Agent Talk app. "
                    f"Current room members: {member_names}. "
                    f"Recent conversation:\n{transcript}\n\n"
                    "Provide a helpful, concise response. Write ONLY your response text."
                )
                
                reply = await self.run_openclaw_agent(prompt)
                if reply:
                    self._api_sync(f"/api/rooms/{room_id}/messages", method="POST", data={"content": reply})
                
                # Ack processed events
                for ev in evs:
                    self._api_sync(f"/api/attention/{ev['id']}/ack", method="POST")

        except Exception as e:
            print(f"[!] Attention Handler Error: {e}")

    async def start_listening(self):
        """Start the WebSocket event loop."""
        if not self.token:
            self.authenticate()

        retry_delay = 1
        
        while True:
            try:
                print(f"[*] Connecting WebSocket to {self.ws_url}/ws/events...")
                retry_delay = 1 # Reset backoff
                
                async with websockets.connect(f"{self.ws_url}/ws/events?token={self.token}") as ws:
                    print(f"[+] Connected to Agent Talk Server!")
                    
                    # Initial check for any missed events
                    await self.handle_attention()
                    
                    while True:
                        msg = await ws.recv()
                        data = json.loads(msg)
                        
                        if data.get("type") in ["attention.created", "message.created"]:
                            # Small delay to let DB settle if needed
                            await asyncio.sleep(0.5)
                            await self.handle_attention()

            except (ConnectionClosed, ConnectionRefusedError, urllib.error.URLError) as e:
                print(f"[!] Connection failed: {e}. Retrying in {retry_delay}s...")
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 60) # Exponential backoff
            except Exception as e:
                print(f"[!] Critical WebSocket Error: {e}")
                await asyncio.sleep(5)

    def start(self):
        """Blocking call to start the connector loop."""
        print("=== Agent Talk external connector initialized ===")
        self.authenticate()
        try:
            asyncio.run(self.start_listening())
        except KeyboardInterrupt:
            print("\n[!] Connector stopped gracefully.")
