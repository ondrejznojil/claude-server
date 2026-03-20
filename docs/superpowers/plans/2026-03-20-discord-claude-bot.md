# Discord Claude Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js Discord bot that proxies messages to Claude Code CLI and deploy it on Coolify at ondrej-claude.mdfx.cz.

**Architecture:** discord.js bot listens for @mentions and messages in a dedicated channel, passes them to `claude --print` via stdin with per-user conversation history prepended, stores history as JSON files, and replies back to Discord. A minimal HTTP server on port 3000 serves `/health` for Coolify health checks.

**Tech Stack:** Node.js 20, discord.js v14, Claude Code CLI (`@anthropic-ai/claude-code`), Docker (Alpine), node:test (built-in)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Project dependencies and scripts |
| `.env.example` | Documents all required env vars |
| `src/bot.js` | Discord client, message routing, slash command registration, HTTP health check |
| `src/claude.js` | Spawns `claude --print` subprocess, passes prompt via stdin, returns response |
| `src/context.js` | Reads/writes per-user JSON history, enforces 20-turn cap, formats prompts |
| `tests/context.test.js` | Unit tests for context manager (uses temp dir) |
| `tests/claude.test.js` | Unit tests for claude runner (mocks child_process) |
| `Dockerfile` | Node.js 20 Alpine, installs Claude CLI via npm |
| `entrypoint.sh` | Conditional credential setup, then starts the app |

---

### Task 1: Project initialization

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "claude-server",
  "version": "1.0.0",
  "description": "Discord bot proxying messages to Claude Code CLI",
  "main": "src/bot.js",
  "scripts": {
    "start": "node src/bot.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.7"
  }
}
```

- [ ] **Step 2: Create .env.example**

```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=channel_id_for_dedicated_claude_channel
DISCORD_GUILD_ID=your_discord_server_id
CLAUDE_CREDENTIALS=contents_of_~/.claude/.credentials.json
```

- [ ] **Step 3: Update .gitignore**

Append to existing `.gitignore`:
```
data/
node_modules/
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 5: Create directory structure**

```bash
mkdir -p src tests data logs
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "feat: initialize Node.js project"
```

---

### Task 2: Context Manager

**Files:**
- Create: `src/context.js`
- Create: `tests/context.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/context.test.js`:

```js
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Override DATA_DIR to a temp directory for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-test-'));
process.env.DATA_DIR = tmpDir;

const { getHistory, appendMessage, resetContext, formatPrompt } = require('../src/context');

beforeEach(() => {
  // Clean temp dir before each test
  for (const f of fs.readdirSync(tmpDir)) {
    fs.unlinkSync(path.join(tmpDir, f));
  }
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('getHistory', () => {
  test('returns empty array for unknown user', () => {
    assert.deepEqual(getHistory('user1'), []);
  });

  test('returns saved history', () => {
    appendMessage('user1', 'user', 'Hello');
    const history = getHistory('user1');
    assert.equal(history.length, 1);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Hello');
  });
});

describe('appendMessage', () => {
  test('saves message with timestamp', () => {
    appendMessage('user1', 'user', 'Hello');
    const history = getHistory('user1');
    assert.ok(history[0].timestamp);
  });

  test('caps history at 40 entries (20 turns)', () => {
    for (let i = 0; i < 25; i++) {
      appendMessage('user1', 'user', `msg ${i}`);
      appendMessage('user1', 'assistant', `reply ${i}`);
    }
    const history = getHistory('user1');
    assert.equal(history.length, 40);
    // Should keep the most recent entries
    assert.equal(history[history.length - 1].content, 'reply 24');
  });
});

describe('resetContext', () => {
  test('deletes user history file', () => {
    appendMessage('user1', 'user', 'Hello');
    resetContext('user1');
    assert.deepEqual(getHistory('user1'), []);
  });

  test('does not throw if no history exists', () => {
    assert.doesNotThrow(() => resetContext('unknown-user'));
  });
});

describe('formatPrompt', () => {
  test('returns just current message when no history', () => {
    const result = formatPrompt([], 'Hello');
    assert.equal(result, 'User: Hello');
  });

  test('prepends conversation history', () => {
    const history = [
      { role: 'user', content: 'Hi', timestamp: '' },
      { role: 'assistant', content: 'Hello!', timestamp: '' }
    ];
    const result = formatPrompt(history, 'How are you?');
    assert.ok(result.includes('[Previous conversation]'));
    assert.ok(result.includes('User: Hi'));
    assert.ok(result.includes('Assistant: Hello!'));
    assert.ok(result.endsWith('User: How are you?'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/context.test.js
```

Expected: FAIL — `Cannot find module '../src/context'`

- [ ] **Step 3: Implement context.js**

Create `src/context.js`:

```js
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_ENTRIES = 40; // 20 turns × 2 (user + assistant)

function historyPath(userId) {
  return path.join(DATA_DIR, `${userId}.json`);
}

function getHistory(userId) {
  const filePath = historyPath(userId);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function appendMessage(userId, role, content) {
  let history = getHistory(userId);
  history.push({ role, content, timestamp: new Date().toISOString() });
  history = history.slice(-MAX_ENTRIES);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(historyPath(userId), JSON.stringify(history, null, 2));
}

function resetContext(userId) {
  const filePath = historyPath(userId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function formatPrompt(history, currentMessage) {
  let prompt = '';
  if (history.length > 0) {
    prompt += '[Previous conversation]\n';
    for (const entry of history) {
      const role = entry.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${entry.content}\n`;
    }
    prompt += '\n';
  }
  prompt += `User: ${currentMessage}`;
  return prompt;
}

module.exports = { getHistory, appendMessage, resetContext, formatPrompt };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/context.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context.js tests/context.test.js
git commit -m "feat: add context manager with per-user history and 20-turn cap"
```

---

### Task 3: Claude Runner

**Files:**
- Create: `src/claude.js`
- Create: `tests/claude.test.js`

- [ ] **Step 1: Verify claude CLI stdin behavior**

Run locally to confirm stdin works:

```bash
echo "User: Say hello in one word" | claude --print
```

Expected: Claude responds with a single word. If this fails, check if `claude --print` reads from stdin when no positional argument is given. If stdin doesn't work, try: `claude -p "Say hello in one word"` (positional arg mode) and adjust `src/claude.js` accordingly.

- [ ] **Step 2: Write the failing tests**

Create `tests/claude.test.js`:

```js
const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

// Mock child_process.spawn before requiring claude.js
const { spawn } = require('child_process');

function makeMockProc({ stdout = '', exitCode = 0, errorMessage = null }) {
  const proc = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  process.nextTick(() => {
    if (errorMessage) {
      proc.emit('error', new Error(errorMessage));
    } else {
      proc.stdout.emit('data', Buffer.from(stdout));
      proc.emit('close', exitCode);
    }
  });

  return proc;
}

describe('runClaude', () => {
  test('returns trimmed stdout on success', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ stdout: '  Hello!\n' })
    );
    const { runClaude } = require('../src/claude');
    const result = await runClaude('User: Hi');
    assert.equal(result, 'Hello!');
    mock.restoreAll();
  });

  test('rejects on non-zero exit code', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ exitCode: 1 })
    );
    const { runClaude } = require('../src/claude');
    await assert.rejects(runClaude('User: Hi'), /exited with code 1/);
    mock.restoreAll();
  });

  test('rejects on spawn error', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ errorMessage: 'ENOENT' })
    );
    const { runClaude } = require('../src/claude');
    await assert.rejects(runClaude('User: Hi'), /ENOENT/);
    mock.restoreAll();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
node --test tests/claude.test.js
```

Expected: FAIL — `Cannot find module '../src/claude'`

- [ ] **Step 4: Implement claude.js**

Create `src/claude.js`:

```js
const { spawn } = require('child_process');

const TIMEOUT_MS = 120000; // 2 minutes

async function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    function settle(fn) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    }

    const timer = setTimeout(() => {
      proc.kill();
      settle(() => reject(new Error('claude timed out after 2 minutes')));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      settle(() => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    proc.on('error', (err) => {
      settle(() => reject(err));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

module.exports = { runClaude };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test tests/claude.test.js
```

Expected: All tests PASS.

- [ ] **Step 6: Run all tests**

```bash
node --test tests/
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/claude.js tests/claude.test.js
git commit -m "feat: add claude CLI runner with stdin input and timeout"
```

---

### Task 4: Discord Bot

**Files:**
- Create: `src/bot.js`

No unit tests for bot.js — it's pure integration (Discord API). Verified manually after deploy.

- [ ] **Step 1: Create bot.js**

Create `src/bot.js`:

```js
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const http = require('http');
const { runClaude } = require('./claude');
const { getHistory, appendMessage, resetContext, formatPrompt } = require('./context');

// ── Health check HTTP server (required by Coolify) ──────────────────────────
const healthServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(3000, () => console.log('Health check listening on :3000'));

// ── Message splitting ────────────────────────────────────────────────────────
const MAX_LEN = 2000;

function splitMessage(text) {
  if (text.length <= MAX_LEN) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      parts.push(remaining);
      break;
    }
    const cut = remaining.lastIndexOf(' ', MAX_LEN);
    const splitAt = cut > 0 ? cut : MAX_LEN;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return parts;
}

// ── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Register slash commands once bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('new')
      .setDescription('Reset your conversation context with Claude')
      .toJSON()
  ];

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log('Slash commands registered');
});

// Handle /new slash command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'new') {
    resetContext(interaction.user.id);
    await interaction.reply({
      content: 'Your conversation context has been reset.',
      ephemeral: true
    });
  }
});

// Handle messages
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const inDedicatedChannel = message.channelId === process.env.DISCORD_CHANNEL_ID;
  const isMentioned = message.mentions.has(client.user);

  if (!inDedicatedChannel && !isMentioned) return;

  // Strip all @mentions from message content
  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) return;

  // Show typing indicator while waiting for Claude
  await message.channel.sendTyping();

  try {
    const history = getHistory(message.author.id);
    const prompt = formatPrompt(history, content);
    const response = await runClaude(prompt);

    appendMessage(message.author.id, 'user', content);
    appendMessage(message.author.id, 'assistant', response);

    const parts = splitMessage(response);
    for (const part of parts) {
      await message.reply(part);
    }
  } catch (err) {
    console.error('Error running claude:', err);
    await message.reply('Something went wrong. Please try again.');
  }
});

client.login(process.env.DISCORD_TOKEN);
```

- [ ] **Step 2: Commit**

```bash
git add src/bot.js
git commit -m "feat: add discord bot with mention/channel triggers and /new command"
```

---

### Task 5: Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `entrypoint.sh`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine

# Install bash (needed for entrypoint) and curl (for potential debugging)
RUN apk add --no-cache bash curl

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY src/ ./src/

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Runtime directories (actual data comes from volumes)
RUN mkdir -p /root/.claude data

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Create entrypoint.sh**

```bash
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
```

- [ ] **Step 3: Build the image locally to verify it builds**

```bash
docker build -t claude-server:test .
```

Expected: Build succeeds, `claude` binary is available in the image.

- [ ] **Step 4: Verify claude is installed inside the image**

```bash
docker run --rm claude-server:test claude --version
```

Expected: prints Claude Code CLI version.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile entrypoint.sh
git commit -m "feat: add Dockerfile and entrypoint with conditional credential setup"
```

---

### Task 6: Push to remote and create Coolify application

**Prerequisites:**
- This repo must be pushed to a remote Git host (GitHub, GitLab, etc.) accessible by Coolify
- You need: `COOLIFY_TOKEN` and `COOLIFY_URL` (already in `.env`)

- [ ] **Step 1: Push repo to remote**

If not already done, create a remote repo (e.g. GitHub) and push:

```bash
git remote add origin <your-repo-url>
git push -u origin main
```

- [ ] **Step 2: Find the Galadriel server ID**

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/servers" | jq '.[] | {id, name}'
```

Note the `id` of the server named `Galadriel`.

- [ ] **Step 3: Find or create a Coolify project**

```bash
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/projects" | jq '.[] | {id, name}'
```

Use an existing project or create one:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  "$COOLIFY_URL/projects" \
  -d '{"name": "claude-server"}' | jq '{id, name}'
```

Note the `uuid` of the project.

- [ ] **Step 4: Create the application in Coolify**

Replace `<SERVER_UUID>`, `<PROJECT_UUID>`, and `<REPO_URL>` with real values:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  "$COOLIFY_URL/applications" \
  -d '{
    "project_uuid": "<PROJECT_UUID>",
    "server_uuid": "<SERVER_UUID>",
    "environment_name": "production",
    "git_repository": "<REPO_URL>",
    "git_branch": "main",
    "build_pack": "dockerfile",
    "name": "claude-server",
    "domains": "https://ondrej-claude.mdfx.cz",
    "ports_exposes": "3000",
    "health_check_enabled": true,
    "health_check_path": "/health",
    "health_check_port": "3000"
  }' | jq '{uuid, name}'
```

Note the application `uuid`.

- [ ] **Step 5: Set environment variables**

Replace `<APP_UUID>` and values:

```bash
APP_UUID="<APP_UUID>"

for VAR in \
  "DISCORD_TOKEN=<your_discord_bot_token>" \
  "DISCORD_CHANNEL_ID=<channel_id>" \
  "DISCORD_GUILD_ID=<guild_id>" \
  "CLAUDE_CREDENTIALS=<contents_of_credentials_json>"; do
  KEY="${VAR%%=*}"
  VALUE="${VAR#*=}"
  curl -s -X POST \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H "Content-Type: application/json" \
    "$COOLIFY_URL/applications/$APP_UUID/envs" \
    -d "{\"key\": \"$KEY\", \"value\": \"$VALUE\", \"is_secret\": true}"
done
```

Note: `CLAUDE_CREDENTIALS` is the full JSON content of `~/.claude/.credentials.json` from your local machine (run `cat ~/.claude/.credentials.json`).

- [ ] **Step 6: Configure persistent volumes in Coolify**

In the Coolify UI (or via API), add two persistent volumes to the application:
- `/root/.claude` → persists Claude auth tokens
- `/app/data` → persists conversation histories

Via Coolify UI: Application → Storages → Add Storage:
- Source: (leave empty for named volume) | Destination: `/root/.claude`
- Source: (leave empty for named volume) | Destination: `/app/data`

- [ ] **Step 7: Deploy the application**

```bash
curl -s -X POST \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/applications/<APP_UUID>/deploy" | jq .
```

Watch the deployment logs in Coolify UI.

- [ ] **Step 8: Verify health check**

```bash
curl -s https://ondrej-claude.mdfx.cz/health
```

Expected: `OK`

- [ ] **Step 9: Test the bot in Discord**

1. @mention the bot in any channel: `@claude-bot Hello!`
2. Send a message in the dedicated channel
3. Use `/new` to reset context
4. Verify context persists across messages

---

## Manual steps required from you

The following steps cannot be automated and require your action:

1. **Create Discord bot** — Go to https://discord.com/developers/applications, create a bot, enable "Message Content Intent", invite it to your server with permissions: Send Messages, Read Messages, Use Slash Commands
2. **Get Discord credentials** — Copy the bot token, dedicated channel ID (right-click channel → Copy ID), and server/guild ID (right-click server → Copy ID)
3. **Get Claude credentials** — Run `claude login` locally if not done, then `cat ~/.claude/.credentials.json`
4. **Push repo to GitHub/GitLab** — Coolify needs a publicly accessible (or SSH-accessible) Git URL
5. **Add persistent volumes in Coolify UI** — Step 6 above is easiest done via UI
