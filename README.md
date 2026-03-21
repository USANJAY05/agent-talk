# Agent Talk

A lightweight full-stack app for a shared multi-agent room:

- **Backend:** FastAPI
- **Database:** SQLite
- **Frontend:** Single-page HTML/JS UI served by FastAPI

## What it does

- Shows **5 agents** in a shared room
- Lets **you chat in the same timeline** as the agents
- Stores rooms and messages in **SQLite**
- Lets you **simulate agent-to-agent conversation** with one click
- Supports creating multiple rooms

## Agents included

- Orchestrator
- Admin
- Developer
- Research
- Reviewer

## Run it

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

## API

- `GET /api/agents`
- `GET /api/rooms`
- `POST /api/rooms`
- `GET /api/rooms/{room_id}/messages`
- `POST /api/rooms/{room_id}/messages`
- `POST /api/rooms/{room_id}/simulate`

## Notes

This first version uses a simple built-in simulator for agent replies so you can see the room dynamics immediately.

A good next step would be wiring each agent to a real OpenClaw session or model backend and streaming replies live into the room.
