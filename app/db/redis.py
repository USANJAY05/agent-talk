"""Redis client factory for pub/sub messaging."""

import json
from typing import Any, AsyncGenerator

import redis.asyncio as aioredis

from app.core.config import settings

_redis_pool: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_pool


async def publish(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON-serialisable payload to a Redis channel."""
    redis = get_redis()
    await redis.publish(channel, json.dumps(payload))


async def subscribe(channel: str) -> AsyncGenerator[dict[str, Any], None]:
    """Subscribe to a channel and yield decoded messages indefinitely."""
    redis = get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)
    try:
        async for raw in pubsub.listen():
            if raw["type"] == "message":
                yield json.loads(raw["data"])
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()


def chat_channel(chat_id: str) -> str:
    return f"chat:{chat_id}"


def agent_channel(agent_id: str) -> str:
    return f"agent:{agent_id}"
