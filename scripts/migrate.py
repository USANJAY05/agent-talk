import asyncio
from sqlalchemy import text
from app.db.session import engine

async def migrate():
    async with engine.begin() as conn:
        print("Migrating database... (adding attachment_url and messagetype values)")
        try:
            # Add attachment_url column
            await conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(512);"))
            print("Added attachment_url column... (or it already exists)")
        except Exception as e:
            print(f"Error adding attachment_url: {e}")

        # Add Enum values
        # Note: PostgreSQL requires each ADD VALUE to be in its own transaction or handled separately.
        # But for 'ADD VALUE IF NOT EXISTS' it's tricky since it doesn't exist for enums until PG12+.
        # We'll just try each one.
        for val in ['video', 'audio']:
            try:
                # We wrap in a block to catch 'already exists' error
                await conn.execute(text(f"ALTER TYPE messagetype ADD VALUE IF NOT EXISTS '{val}';"))
                print(f"Added '{val}' to messagetype enum...")
            except Exception as e:
                # Fallback for older PG or if 'IF NOT EXISTS' is not supported there
                # We'll just ignore the 'duplicate' error
                if 'already exists' in str(e).lower():
                    print(f"'{val}' already exists in messagetype enum.")
                else:
                    print(f"Warning: could not add '{val}' to messagetype: {e}")

    print("Migration complete.")

if __name__ == "__main__":
    asyncio.run(migrate())
