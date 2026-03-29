"""Unit tests for app.core.security — JWT and password utilities."""

import time
import pytest
from jose import JWTError

from app.core.security import (
    create_access_token,
    create_agent_token,
    decode_token,
    hash_password,
    verify_password,
)


# ── Password tests ────────────────────────────────────────────────────────────

class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        hashed = hash_password("secret123")
        assert hashed != "secret123"
        assert len(hashed) > 20

    def test_verify_correct_password(self):
        hashed = hash_password("correct")
        assert verify_password("correct", hashed) is True

    def test_reject_wrong_password(self):
        hashed = hash_password("correct")
        assert verify_password("wrong", hashed) is False

    def test_same_password_different_hashes(self):
        """bcrypt generates a unique salt each time."""
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2
        assert verify_password("same", h1)
        assert verify_password("same", h2)


# ── JWT tests ─────────────────────────────────────────────────────────────────

class TestJWT:
    def test_access_token_roundtrip(self):
        token = create_access_token("user-123")
        payload = decode_token(token)
        assert payload["sub"] == "user-123"
        assert payload["type"] == "human"

    def test_access_token_extra_claims(self):
        token = create_access_token("user-456", extra={"role": "admin"})
        payload = decode_token(token)
        assert payload["role"] == "admin"

    def test_agent_token_roundtrip(self):
        token = create_agent_token("agent-abc", "jti-xyz")
        payload = decode_token(token)
        assert payload["sub"] == "agent-abc"
        assert payload["type"] == "agent"
        assert payload["jti"] == "jti-xyz"

    def test_tampered_token_raises(self):
        token = create_access_token("user-789")
        tampered = token[:-4] + "xxxx"
        with pytest.raises(JWTError):
            decode_token(tampered)

    def test_garbage_token_raises(self):
        with pytest.raises(JWTError):
            decode_token("not.a.token")
