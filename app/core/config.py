"""Application configuration via environment variables."""

import json
from typing import Any, List

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── App ───────────────────────────────────────────────────────────────────
    APP_ENV: str = "development"
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24       # 1 day
    AGENT_TOKEN_EXPIRE_MINUTES: int = 10              # reserved — not used in JWT (DB jti is revocation)
    WEBHOOK_SECRET: str = "change-me-webhook-secret"

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://agenttalk:agenttalk@localhost:5432/agenttalk"

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Accepts: "*"  or  "http://localhost:5173,http://localhost:3000"
    # or JSON:  '["http://localhost:5173","http://localhost:3000"]'
    ALLOWED_ORIGINS: str | List[str] = ["*"]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: Any) -> List[str]:
        """
        Accept ALLOWED_ORIGINS in three env formats:
          ALLOWED_ORIGINS=*
          ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
          ALLOWED_ORIGINS=["http://localhost:5173","http://localhost:3000"]
        """
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            v = v.strip()
            # JSON array form
            if v.startswith("["):
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    pass
            # Single wildcard or single origin
            if "," not in v:
                return [v]
            # Comma-separated
            return [o.strip() for o in v.split(",") if o.strip()]
        return ["*"]

    # ── Pagination ────────────────────────────────────────────────────────────
    DEFAULT_PAGE_SIZE: int = 50
    MAX_PAGE_SIZE: int = 200

    # ── Rate limiting ─────────────────────────────────────────────────────────
    RATE_LIMIT_REQUESTS: int = 120      # requests per window
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "ignore",
    }


settings = Settings()
