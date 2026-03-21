#!/bin/bash
set -e

# Create required directories if they don't exist
mkdir -p /app/data /workspace /home/app/.ssh /home/app/.claude
chown -R app:app /app/data /workspace /home/app

# Write credentials only if the file doesn't already exist
# (preserves auto-refreshed tokens on restart)
CREDS_FILE=/home/app/.claude/.credentials.json
if [ ! -f "$CREDS_FILE" ]; then
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
    echo "$CLAUDE_CREDENTIALS" > "$CREDS_FILE"
    chown app:app "$CREDS_FILE"
    echo "Claude credentials written from CLAUDE_CREDENTIALS env var"
  else
    echo "WARNING: No CLAUDE_CREDENTIALS env var and no existing credentials file. Claude CLI will fail to authenticate."
  fi
else
  echo "Claude credentials file already exists, skipping write"
fi

# Drop to non-root user (required for --dangerously-skip-permissions)
exec su-exec app node /app/src/bot.js
