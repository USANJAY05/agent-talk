#!/bin/bash
set -e

cd "$(dirname "$0")"

# Setup backend
echo "Starting backend..."
if [ ! -d ".venv" ]; then
    echo "Creating .venv..."
    python3 -m venv .venv
fi
source .venv/bin/activate

if ! command -v uvicorn &> /dev/null; then
    echo "Installing backend requirements..."
    pip install -r requirements.txt
fi

uvicorn backend.main:app --host 0.0.0.0 --port 8010 &
BACKEND_PID=$!

# Setup frontend
echo "Starting frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend packages..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!

echo "========================================="
echo "Both systems running."
echo "Frontend: http://localhost:5173"
echo "Backend: http://localhost:8010"
echo "Press Ctrl+C to stop both."
echo "========================================="

trap "echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID; exit" EXIT INT TERM
wait
