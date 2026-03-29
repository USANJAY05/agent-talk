"""Async SQLAlchemy engine and session factory."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


async def init_db() -> None:
    """Create all tables (use Alembic for production migrations)."""
    # Import all models so they register on Base.metadata
    import app.models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Backward-compatible schema patch for deployments that added pairing fields
        # in models but haven't run Alembic migrations yet.
        if conn.dialect.name == "postgresql":
            await conn.execute(text("ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS name VARCHAR(120)"))
            await conn.execute(text("ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS pairing_code VARCHAR(12)"))
            await conn.execute(text("ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS is_paired BOOLEAN DEFAULT FALSE"))
            await conn.execute(text("ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS paired_at TIMESTAMPTZ"))
            await conn.execute(text("ALTER TABLE agent_tokens ALTER COLUMN expires_at DROP NOT NULL"))
            await conn.execute(text("UPDATE agent_tokens SET name = COALESCE(name, 'Unnamed Token') WHERE name IS NULL"))
            await conn.execute(text("UPDATE agent_tokens SET pairing_code = '000000' WHERE pairing_code IS NULL"))
            await conn.execute(text("UPDATE agent_tokens SET is_paired = FALSE WHERE is_paired IS NULL"))
