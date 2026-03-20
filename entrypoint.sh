#!/bin/bash
set -e

# Create data directory if it doesn't exist
mkdir -p /app/data

# Write credentials only if the file doesn't already exist
# (preserves auto-refreshed tokens on restart)
if [ ! -f /root/.claude/.credentials.json ]; then
  if [ -n "$CLAUDE_CREDENTIALS" ]; then
    # Validate JSON before writing
    echo "$CLAUDE_CREDENTIALS" | node -e "
      let data = '';
      process.stdin.on('data', c => data += c);
      process.stdin.on('end', () => {
        try { JSON.parse(data); }
        catch(e) { console.error('CLAUDE_CREDENTIALS is not valid JSON:', e.message); process.exit(1); }
      });
    "
    mkdir -p /root/.claude
    echo "$CLAUDE_CREDENTIALS" > /root/.claude/.credentials.json
    echo "Claude credentials written from CLAUDE_CREDENTIALS env var"
  else
    echo "WARNING: No CLAUDE_CREDENTIALS env var and no existing credentials file. Claude CLI will fail to authenticate."
  fi
else
  echo "Claude credentials file already exists, skipping write"
fi

exec node /app/src/bot.js
