"""Unit tests for invite validity checks (pure logic, no DB)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.services.invite_service import _check_invite_validity


def _make_invite(*, is_active=True, expires_at=None, max_uses=None, use_count=0):
    inv = MagicMock()
    inv.is_active = is_active
    inv.expires_at = expires_at
    inv.max_uses = max_uses
    inv.use_count = use_count
    return inv


class TestInviteValidity:
    def test_valid_invite(self):
        invite = _make_invite()
        is_valid, reason = _check_invite_validity(invite)
        assert is_valid is True
        assert reason is None

    def test_revoked_invite(self):
        invite = _make_invite(is_active=False)
        is_valid, reason = _check_invite_validity(invite)
        assert is_valid is False
        assert "revoked" in reason.lower()

    def test_expired_invite(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        invite = _make_invite(expires_at=past)
        is_valid, reason = _check_invite_validity(invite)
        assert is_valid is False
        assert "expired" in reason.lower()

    def test_future_expiry_is_valid(self):
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        invite = _make_invite(expires_at=future)
        is_valid, _ = _check_invite_validity(invite)
        assert is_valid is True

    def test_max_uses_reached(self):
        invite = _make_invite(max_uses=5, use_count=5)
        is_valid, reason = _check_invite_validity(invite)
        assert is_valid is False
        assert "maximum" in reason.lower()

    def test_max_uses_not_yet_reached(self):
        invite = _make_invite(max_uses=5, use_count=4)
        is_valid, _ = _check_invite_validity(invite)
        assert is_valid is True

    def test_unlimited_uses(self):
        invite = _make_invite(max_uses=None, use_count=9999)
        is_valid, _ = _check_invite_validity(invite)
        assert is_valid is True

    def test_revoked_takes_precedence_over_not_expired(self):
        future = datetime.now(timezone.utc) + timedelta(hours=24)
        invite = _make_invite(is_active=False, expires_at=future)
        is_valid, reason = _check_invite_validity(invite)
        assert is_valid is False
        assert "revoked" in reason.lower()
