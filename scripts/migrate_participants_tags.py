
import asyncio
from sqlalchemy import text
from app.db.session import engine

async def migrate():
    async with engine.begin() as conn:
        print("Checking for tags column in participants table...")
        try:
            await conn.execute(text("ALTER TABLE participants ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]' NOT NULL;"))
            print("Successfully added tags column to participants.")
        except Exception as e:
            print(f"Error adding tags column: {e}")
            
        try:
            await conn.execute(text("COMMENT ON COLUMN participants.tags IS 'Custom tags for categorization.';"))
            print("Added comment to tags column.")
        except Exception as e:
            print(f"Error adding comment: {e}")

if __name__ == "__main__":
    asyncio.run(migrate())
