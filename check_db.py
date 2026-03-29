import asyncio
import sys
from sqlalchemy import inspect, text
from app.db.session import engine

async def check():
    try:
        async with engine.connect() as conn:
            # Check participants columns
            def get_cols(connection, table):
                return [c['name'] for c in inspect(connection).get_columns(table)]
            
            p_cols = await conn.run_sync(lambda c: get_cols(c, 'participants'))
            print(f"Participants columns: {p_cols}")
            
            p_missing = [n for n in ['username', 'bio'] if n not in p_cols]
            for m in p_missing:
                print(f"Adding participants.{m}")
                await conn.execute(text(f'ALTER TABLE participants ADD COLUMN {m} {"TEXT" if m == "bio" else "VARCHAR(100)"}'))
            
            # Check agents columns
            a_cols = await conn.run_sync(lambda c: get_cols(c, 'agents'))
            print(f"Agents columns: {a_cols}")
            
            a_needed = ['passive_listen', 'owner_presence']
            a_missing = [n for n in a_needed if n not in a_cols]
            for m in a_missing:
                print(f"Adding agents.{m}")
                await conn.execute(text(f'ALTER TABLE agents ADD COLUMN {m} BOOLEAN DEFAULT {"FALSE" if m == "passive_listen" else "TRUE"}'))
            
            await conn.commit()
            print("Done.")
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(check())
