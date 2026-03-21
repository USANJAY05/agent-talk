from __future__ import annotations

import unittest

from bridge_worker import should_reply


class BridgeWorkerTests(unittest.TestCase):
    def test_should_not_reply_to_own_latest_message_when_account_id_is_normalized(self) -> None:
        room_events = [{"event_type": "message.created", "message_id": 3}]
        messages = [
            {"id": 2, "account_id": "owner", "content": "ping"},
            {"id": 3, "account_id": "terminalagent", "content": "already replied"},
        ]
        self.assertFalse(should_reply(room_events, messages, self_account_id="terminalagent"))

    def test_should_reply_when_latest_message_is_from_someone_else(self) -> None:
        room_events = [{"event_type": "message.created", "message_id": 4}]
        messages = [
            {"id": 4, "account_id": "owner", "content": "need help"},
        ]
        self.assertTrue(should_reply(room_events, messages, self_account_id="terminalagent"))


if __name__ == "__main__":
    unittest.main()
