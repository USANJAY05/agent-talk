#!/bin/bash

cd "$(dirname "$0")"

TARGET=${1:-all}

echo "Stopping Agent Talk services ($TARGET)..."

if [[ "$TARGET" == "all" || "$TARGET" == "backend" ]]; then
    if pgrep -f "uvicorn backend.main:app" > /dev/null; then
        pkill -f "uvicorn backend.main:app"
        echo "Backend process killed."
    else
        echo "Backend process not found."
    fi
    lsof -t -i :8010 | xargs kill -9 2>/dev/null || true
    echo "Backend ports cleared."
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
    if pgrep -f "npm run dev" > /dev/null; then
        pkill -f "npm run dev"
        echo "Frontend (npm) process killed."
    else
        echo "Frontend (npm) process not found."
    fi

    if pgrep -f "vite" > /dev/null; then
        pkill -f "vite"
        echo "Vite process killed."
    fi
    lsof -t -i :5173 | xargs kill -9 2>/dev/null || true
    lsof -t -i :5174 | xargs kill -9 2>/dev/null || true
    echo "Frontend ports cleared."
fi

echo "Done."
