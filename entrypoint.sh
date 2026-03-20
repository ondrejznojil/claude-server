#!/bin/bash
set -e

# Create data directory if it doesn't exist
mkdir -p /app/data

# Write credentials only if the file doesn't already exist
# (preserves auto-refreshed tokens on restart)
if [ ! -f /root/.claude/.credentials.json ] && [ -n "$CLAUDE_CREDENTIALS" ]; then
  mkdir -p /root/.claude
  echo "$CLAUDE_CREDENTIALS" > /root/.claude/.credentials.json
  echo "Claude credentials written from CLAUDE_CREDENTIALS env var"
else
  echo "Claude credentials file already exists, skipping write"
fi

exec node /app/src/bot.js
