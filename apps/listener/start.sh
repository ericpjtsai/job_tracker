#!/bin/bash
# Start the Job Tracker listener locally
# Usage: ./apps/listener/start.sh

cd "$(dirname "$0")"
set -a && source .env.local && set +a
echo "Starting Job Tracker listener on port ${CONTROL_PORT:-3001}..."
npx tsx src/index.ts
