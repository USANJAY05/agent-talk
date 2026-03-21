from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

import backend.main as main


class AgentTalkWebSocketTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        db_path = Path(self.tempdir.name) / "test.sqlite3"

        main.DB_PATH = db_path
        main.engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        main.SessionLocal = sessionmaker(bind=main.engine, autoflush=False, autocommit=False)
        main.Base.metadata.create_all(bind=main.engine)
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        main.Base.metadata.drop_all(bind=main.engine)
        main.engine.dispose()
        self.tempdir.cleanup()

    def signup(self, *, name: str, username: str) -> dict:
        response = self.client.post(
            "/api/signup",
            json={
                "name": name,
                "username": username,
                "password": "secret123",
                "account_type": "human",
                "role": "Operator",
                "color": "#4f46e5",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def assert_ws_close_code(self, path: str, expected_code: int) -> None:
        with self.assertRaises(WebSocketDisconnect) as context:
            with self.client.websocket_connect(path) as websocket:
                websocket.receive_text()
        self.assertEqual(context.exception.code, expected_code)

    def test_websocket_rejects_invalid_or_unauthorized_sessions(self) -> None:
        owner = self.signup(name="Owner", username="owner")
        outsider = self.signup(name="Outsider", username="outsider")
        response = self.client.post(
            "/api/rooms",
            headers=self.auth_headers(owner["token"]),
            json={"name": "Private Ops", "room_type": "group", "member_ids": []},
        )
        self.assertEqual(response.status_code, 200, response.text)
        room_id = response.json()["id"]

        self.assert_ws_close_code(f"/ws/rooms/{room_id}?token=bad-token", 4401)
        self.assert_ws_close_code(f"/ws/rooms/{room_id}?token={outsider['token']}", 4403)

    def test_room_broadcasts_messages_to_connected_members(self) -> None:
        owner = self.signup(name="Owner", username="owner")
        member = self.signup(name="Member", username="member")

        response = self.client.post(
            "/api/rooms",
            headers=self.auth_headers(owner["token"]),
            json={"name": "Ops", "room_type": "group", "member_ids": [member["account"]["id"]]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        room = response.json()

        with self.client.websocket_connect(f"/ws/rooms/{room['id']}?token={owner['token']}") as owner_ws, self.client.websocket_connect(
            f"/ws/rooms/{room['id']}?token={member['token']}"
        ) as member_ws:
            post = self.client.post(
                f"/api/rooms/{room['id']}/messages",
                headers=self.auth_headers(owner["token"]),
                json={"content": "hello room"},
            )
            self.assertEqual(post.status_code, 200, post.text)
            owner_payload = owner_ws.receive_json()
            member_payload = member_ws.receive_json()

        self.assertEqual(owner_payload["type"], "message.created")
        self.assertEqual(member_payload["type"], "message.created")
        self.assertEqual(owner_payload["event_scope"], "room")
        self.assertEqual(member_payload["event_scope"], "room")
        self.assertEqual(owner_payload["message"]["content"], "hello room")
        self.assertEqual(member_payload["message"]["content"], "hello room")

    def test_attention_api_and_event_socket_receive_targeted_wakeups(self) -> None:
        owner = self.signup(name="Owner", username="owner")
        agent = self.client.post(
            "/api/signup",
            json={
                "name": "Bridge Agent",
                "username": "bridge-agent",
                "password": "secret123",
                "account_type": "agent",
                "role": "Bridge",
                "color": "#2563eb",
            },
        ).json()

        response = self.client.post(
            "/api/rooms",
            headers=self.auth_headers(owner["token"]),
            json={"name": "Ops", "room_type": "group", "member_ids": [agent["account"]["id"]]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        room = response.json()

        with self.client.websocket_connect(f"/ws/events?token={agent['token']}") as agent_events:
            post = self.client.post(
                f"/api/rooms/{room['id']}/messages",
                headers=self.auth_headers(owner["token"]),
                json={"content": "wake agent"},
            )
            self.assertEqual(post.status_code, 200, post.text)
            room_echo = agent_events.receive_json()
            attention_echo = agent_events.receive_json()

        self.assertEqual(room_echo["type"], "message.created")
        self.assertEqual(attention_echo["type"], "attention.created")
        self.assertEqual(attention_echo["event_scope"], "account")
        self.assertEqual(attention_echo["account_ids"], [agent["account"]["id"]])
        self.assertEqual(attention_echo["attention"][0]["preview"], "wake agent")

        feed = self.client.get("/api/attention", headers=self.auth_headers(agent["token"]))
        self.assertEqual(feed.status_code, 200, feed.text)
        events = feed.json()
        self.assertEqual(len(events), 1)
        ack = self.client.post(f"/api/attention/{events[0]['id']}/ack", headers=self.auth_headers(agent["token"]), json={})
        self.assertEqual(ack.status_code, 200, ack.text)
        feed_after = self.client.get("/api/attention", headers=self.auth_headers(agent["token"]))
        self.assertEqual(feed_after.status_code, 200, feed_after.text)
        self.assertEqual(feed_after.json(), [])


if __name__ == "__main__":
    unittest.main()
