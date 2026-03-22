#!/bin/bash

cd "$(dirname "$0")"

echo "========================================="
echo "FACTORY RESET DETECTED"
echo "Stopping existing services..."

bash stop.sh all

echo "Deleting local databases..."
rm -f *.sqlite3
rm -f *.db
rm -f .bridge-state.json

echo "Factory reset complete. Starting fresh..."
echo "========================================="

bash run.sh
