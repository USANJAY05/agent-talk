#!/bin/bash

cd "$(dirname "$0")"
echo "Stopping Agent Talk services..."

if pgrep -f "uvicorn backend.main:app" > /dev/null; then
    pkill -f "uvicorn backend.main:app"
    echo "Backend stopped."
else
    echo "Backend not running."
fi

if pgrep -f "npm run dev" > /dev/null; then
    pkill -f "npm run dev"
    echo "Frontend (npm) stopped."
else
    echo "Frontend (npm) not running."
fi

if pgrep -f "vite" > /dev/null; then
    pkill -f "vite"
    echo "Vite stopped."
fi

echo "Done."
