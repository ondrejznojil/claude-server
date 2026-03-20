# Discord Claude Bot — Design Spec

**Date:** 2026-03-20
**Status:** Approved

## Overview

A Discord bot that proxies user messages to Claude Code CLI (`claude --print`), enabling remote interaction with Claude via Discord. The bot uses the user's Claude.ai subscription (not the Anthropic API), so no extra billing.

---

## Architecture

```
Discord → discord.js bot → Context Manager → claude CLI subprocess
                                ↑
                     data/<userId>.json (per-user history)
```

---

## Components

### 1. Discord Bot (`src/bot.js`)

Entry point. Initializes the Discord client and routes incoming messages.

**Triggers:**
- Any message in the dedicated channel (`DISCORD_CHANNEL_ID` env var)
- Any @mention of the bot in any channel

**Ignores:**
- Messages from other bots
- The bot's own messages

**Slash command:**
- `/new` — resets the calling user's conversation context
- Slash commands are registered on bot startup (guild-scoped for instant availability)

**Health check:**
- A minimal HTTP server on port `3000` responds `200 OK` to `GET /health`
- Required for Coolify to detect the app as healthy (Discord bots have no HTTP port by default)

### 2. Claude Runner (`src/claude.js`)

Executes `claude --print` as a child process.

- Receives a formatted prompt (with conversation history prepended)
- Passes the prompt via **stdin** (not as a shell argument) to avoid injection and escaping issues
- Returns the full text response (collected after process exits, not streamed)
- Handles errors (non-zero exit, timeout)

**Prompt format:**
```
[Previous conversation]
User: <msg1>
Assistant: <msg2>
...

User: <current message>
```

### 3. Context Manager (`src/context.js`)

Manages per-user conversation history as JSON files.

- Storage: `data/<userId>.json`
- Each entry: `{ role: "user"|"assistant", content: string, timestamp: ISO }`
- `getHistory(userId)` — loads history from file
- `appendMessage(userId, role, content)` — appends and saves
- `resetContext(userId)` — deletes the user's file
- History is capped at the **last 20 turns** — where 1 turn = 1 user message + 1 assistant reply (40 entries total) — to prevent context window overflow

---

## Message Flow

1. Discord message arrives (mention or dedicated channel)
2. Bot loads user's history from `data/<userId>.json`
3. Bot formats full conversation as a prompt string
4. Prompt is written to `claude --print` subprocess via **stdin**; full output collected after process exits
5. Response is appended to history and saved
6. Bot sends response back to Discord; if response exceeds 2000 chars, it is split at word boundaries into multiple sequential reply messages

---

## Docker (Production)

**Files:**
- `Dockerfile` — Node.js 20 Alpine base, installs Claude CLI at build time
- `entrypoint.sh` — runs credential setup logic before starting the app

```dockerfile
# Node.js 20 Alpine + Claude CLI installed at build time
# entrypoint.sh runs credential setup before starting the app
```

**Volumes:**
- `~/.claude/` — persists Claude auth tokens across restarts (allows auto-refresh)
- `./data/` — persists conversation histories

**Entrypoint logic:**
1. Create `data/` directory if it doesn't exist
2. Write `CLAUDE_CREDENTIALS` to `~/.claude/.credentials.json` **only if the file does not already exist** (preserves auto-refreshed tokens on restart)
3. Start the Node.js app

**Environment variables:**
| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CHANNEL_ID` | ID of the dedicated Claude channel |
| `CLAUDE_CREDENTIALS` | Contents of `~/.claude/.credentials.json` from local login |
| `DISCORD_GUILD_ID` | Guild ID for instant slash command registration |

---

## Coolify Deployment

- **Server:** Galadriel
- **Source:** Git repository (this repo)
- **Domain:** `https://ondrej-claude.mdfx.cz`
- **Build:** Dockerfile in repo root
- **Volumes:** `~/.claude/` and `./data/` configured in Coolify
- **Health check:** `GET https://ondrej-claude.mdfx.cz/health` → `200 OK`
- **Port:** 3000 (internal HTTP health check only)

---

## Auth Strategy

1. Run `claude login` locally → credentials saved to `~/.claude/.credentials.json`
2. Copy file contents → paste as `CLAUDE_CREDENTIALS` env var in Coolify
3. Docker entrypoint writes this env var to `~/.claude/.credentials.json` **only if the file does not already exist**
4. CLI auto-refreshes tokens and saves updated credentials to the mounted volume
5. On container restart, the refreshed token persists from the volume (entrypoint does not overwrite it)

---

## Out of Scope

- Multi-server support (single Discord server only)
- Per-channel context (context is per-user, not per-channel)
- Web dashboard
- Message queuing / rate limiting (can be added later if needed)
