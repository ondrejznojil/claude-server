# Claude Token Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `src/credentials.js` that proactively refreshes the Claude OAuth access token before it expires, preventing silent `claude exit code 1` failures in the Discord bot.

**Architecture:** A new module `src/credentials.js` exports `ensureFreshCredentials()`. Before every `claude` CLI invocation in `src/claude.js`, this function checks the token expiry and calls the Anthropic OAuth refresh endpoint if it expires within 5 minutes. Concurrent calls coalesce into a single in-flight promise. Writes are atomic via tmp-file + rename.

**Tech Stack:** Node.js 20 (built-in `fetch`, `node:test`, `node:assert`, `node:fs`)

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `src/credentials.js` | Token expiry check + OAuth refresh logic |
| Create | `tests/credentials.test.js` | Unit tests for credentials module |
| Modify | `tests/claude.test.js` | Add fresh-credentials setup so existing tests still pass |
| Modify | `src/claude.js` | Call `ensureFreshCredentials()` before spawning CLI |

---

### Task 1: Create `src/credentials.js`

**Files:**
- Create: `src/credentials.js`

- [ ] **Step 1: Write `src/credentials.js`**

Note: `getCredsFile()` reads the env var at call time (not at module load) so tests can override it via `process.env.CLAUDE_CREDS_FILE` without needing to clear the module cache.

```javascript
const fs = require('fs');

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh when < 5 min remaining
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REQUEST_TIMEOUT_MS = 10000;

let refreshInProgress = null;

function getCredsFile() {
  return process.env.CLAUDE_CREDS_FILE || '/home/app/.claude/.credentials.json';
}

function readCredentials() {
  const credsFile = getCredsFile();
  let raw;
  try {
    raw = fs.readFileSync(credsFile, 'utf8');
  } catch {
    throw new Error(`Credentials file not found: ${credsFile}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid credentials format');
  }
}

function writeCredentials(creds) {
  const credsFile = getCredsFile();
  const tmp = credsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), 'utf8');
  fs.renameSync(tmp, credsFile);
}

async function attempt(refreshToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`Token refresh failed: ${res.status} ${body}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Token refresh timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function doRefresh(refreshToken) {
  try {
    return await attempt(refreshToken);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) throw err; // no retry on 4xx
    await new Promise(r => setTimeout(r, 2000));
    return await attempt(refreshToken);
  }
}

async function ensureFreshCredentials() {
  if (refreshInProgress) return refreshInProgress;

  const creds = readCredentials();
  const { expiresAt, refreshToken } = creds.claudeAiOauth;

  if (expiresAt - Date.now() >= REFRESH_THRESHOLD_MS) return;

  console.log('Refreshing Claude credentials...');

  refreshInProgress = (async () => {
    try {
      const response = await doRefresh(refreshToken);
      const updated = {
        ...creds,
        claudeAiOauth: {
          ...creds.claudeAiOauth,
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: Date.now() + response.expires_in * 1000,
        },
      };
      writeCredentials(updated);
      console.log('Claude credentials refreshed successfully');
    } finally {
      refreshInProgress = null;
    }
  })();

  return refreshInProgress;
}

module.exports = { ensureFreshCredentials };
```

- [ ] **Step 2: Verify the file is syntactically valid**

```bash
node -e "require('./src/credentials')"
```

Expected: no output, exit 0.

---

### Task 2: Write and run tests for `src/credentials.js`

**Files:**
- Create: `tests/credentials.test.js`

- [ ] **Step 1: Write `tests/credentials.test.js`**

```javascript
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCreds(overrides = {}) {
  return {
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-test',
      refreshToken: 'sk-ant-ort01-test',
      expiresAt: Date.now() + 60 * 60 * 1000, // 1h from now (fresh)
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      rateLimitTier: 'default_claude_ai',
      ...overrides,
    },
  };
}

function writeCredsFile(filePath, overrides = {}) {
  fs.writeFileSync(filePath, JSON.stringify(makeCreds(overrides)), 'utf8');
}

function readCredsFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const GOOD_RESPONSE = {
  access_token: 'sk-ant-oat01-new',
  refresh_token: 'sk-ant-ort01-new',
  expires_in: 86400,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ensureFreshCredentials', () => {
  let tmpDir;
  let credsFile;
  let originalFetch;
  let originalCredsFile;

  before(() => {
    originalFetch = globalThis.fetch;
    originalCredsFile = process.env.CLAUDE_CREDS_FILE;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (originalCredsFile === undefined) delete process.env.CLAUDE_CREDS_FILE;
    else process.env.CLAUDE_CREDS_FILE = originalCredsFile;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-test-'));
    credsFile = path.join(tmpDir, '.credentials.json');
    process.env.CLAUDE_CREDS_FILE = credsFile;

    // Re-require to reset module-level refreshInProgress = null
    delete require.cache[require.resolve('../src/credentials')];
  });

  it('is a no-op when token has more than 5 minutes remaining', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() + 10 * 60 * 1000 });
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; };

    const { ensureFreshCredentials } = require('../src/credentials');
    await ensureFreshCredentials();

    assert.equal(fetchCalled, false, 'fetch should not be called when token is fresh');
  });

  it('calls refresh when token expires within 5 minutes', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() + 4 * 60 * 1000 });
    globalThis.fetch = async () => ({ ok: true, json: async () => GOOD_RESPONSE });

    const { ensureFreshCredentials } = require('../src/credentials');
    await ensureFreshCredentials();

    const updated = readCredsFile(credsFile);
    assert.equal(updated.claudeAiOauth.accessToken, 'sk-ant-oat01-new');
    assert.equal(updated.claudeAiOauth.refreshToken, 'sk-ant-ort01-new');
    assert.ok(updated.claudeAiOauth.expiresAt > Date.now());
  });

  it('calls refresh when token is already expired', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1000 });
    globalThis.fetch = async () => ({ ok: true, json: async () => GOOD_RESPONSE });

    const { ensureFreshCredentials } = require('../src/credentials');
    await ensureFreshCredentials();

    const updated = readCredsFile(credsFile);
    assert.equal(updated.claudeAiOauth.accessToken, 'sk-ant-oat01-new');
  });

  it('preserves non-token fields (scopes, subscriptionType, rateLimitTier) after refresh', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    globalThis.fetch = async () => ({ ok: true, json: async () => GOOD_RESPONSE });

    const { ensureFreshCredentials } = require('../src/credentials');
    await ensureFreshCredentials();

    const updated = readCredsFile(credsFile);
    assert.deepEqual(updated.claudeAiOauth.scopes, ['user:inference']);
    assert.equal(updated.claudeAiOauth.subscriptionType, 'pro');
    assert.equal(updated.claudeAiOauth.rateLimitTier, 'default_claude_ai');
  });

  it('writes atomically — tmp file is not left behind', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    globalThis.fetch = async () => ({ ok: true, json: async () => GOOD_RESPONSE });

    const { ensureFreshCredentials } = require('../src/credentials');
    await ensureFreshCredentials();

    assert.equal(fs.existsSync(credsFile + '.tmp'), false, '.tmp file should not exist after write');
  });

  it('retries once on transient 500 error and succeeds on second attempt', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 500, text: async () => 'server error' };
      return { ok: true, json: async () => GOOD_RESPONSE };
    };

    const { ensureFreshCredentials } = require('../src/credentials');
    // Patch setTimeout to skip 2s delay
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, _delay) => origSetTimeout(fn, 0);
    try {
      await ensureFreshCredentials();
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }

    assert.equal(calls, 2, 'should have retried once');
    assert.equal(readCredsFile(credsFile).claudeAiOauth.accessToken, 'sk-ant-oat01-new');
  });

  it('does NOT retry on 4xx error', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 400, text: async () => 'invalid_grant' };
    };

    const { ensureFreshCredentials } = require('../src/credentials');
    await assert.rejects(ensureFreshCredentials(), /Token refresh failed: 400/);
    assert.equal(calls, 1, 'should not retry on 400');
  });

  it('throws after two consecutive 5xx failures', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 503, text: async () => 'unavailable' };
    };

    const { ensureFreshCredentials } = require('../src/credentials');
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, _delay) => origSetTimeout(fn, 0);
    try {
      await assert.rejects(ensureFreshCredentials(), /Token refresh failed: 503/);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
    assert.equal(calls, 2);
  });

  it('concurrent calls share a single in-flight promise (no duplicate requests)', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await new Promise(r => setTimeout(r, 10));
      return { ok: true, json: async () => GOOD_RESPONSE };
    };

    const { ensureFreshCredentials } = require('../src/credentials');
    await Promise.all([
      ensureFreshCredentials(),
      ensureFreshCredentials(),
      ensureFreshCredentials(),
    ]);

    assert.equal(calls, 1, 'fetch should only be called once despite concurrent calls');
  });

  it('throws when credentials file does not exist', async () => {
    const { ensureFreshCredentials } = require('../src/credentials');
    await assert.rejects(ensureFreshCredentials(), /Credentials file not found/);
  });

  it('throws when credentials file contains invalid JSON', async () => {
    fs.writeFileSync(credsFile, 'not json', 'utf8');
    const { ensureFreshCredentials } = require('../src/credentials');
    await assert.rejects(ensureFreshCredentials(), /Invalid credentials format/);
  });
});
```

- [ ] **Step 2: Run credentials tests**

```bash
node --test tests/credentials.test.js
```

Expected: all 10 tests pass, 0 failures.

- [ ] **Step 3: Run full test suite**

```bash
node --test tests/
```

Expected: all existing tests (`claude.test.js`, `context.test.js`) still pass. The credentials tests also pass.

- [ ] **Step 4: Commit**

```bash
git add src/credentials.js tests/credentials.test.js
git commit -m "feat: add OAuth token auto-refresh"
```

---

### Task 3: Update `tests/claude.test.js` before integrating

`runClaude()` will call `ensureFreshCredentials()` after Task 4. The existing `claude.test.js` must provide a valid credentials file so `readCredentials()` doesn't throw. Do this before touching `src/claude.js`.

**Files:**
- Modify: `tests/claude.test.js`

- [ ] **Step 1: Add credentials setup to `tests/claude.test.js`**

Add `before` and `after` hooks that write a fresh credentials file to a temp path and set `CLAUDE_CREDS_FILE`. The full updated file:

```javascript
const { test, describe, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// Write a fresh credentials file before any test so ensureFreshCredentials()
// finds a valid, non-expired token and returns without making network calls.
const tmpCredsFile = path.join(os.tmpdir(), `claude-test-creds-${process.pid}.json`);

before(() => {
  fs.writeFileSync(tmpCredsFile, JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-test',
      refreshToken: 'sk-ant-test',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h from now — always fresh
      scopes: [],
      subscriptionType: 'pro',
      rateLimitTier: 'default_claude_ai',
    },
  }));
  process.env.CLAUDE_CREDS_FILE = tmpCredsFile;
});

after(() => {
  fs.rmSync(tmpCredsFile, { force: true });
  delete process.env.CLAUDE_CREDS_FILE;
});

const { runClaude } = require('../src/claude');

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
      proc.emit('close', exitCode, null);
    }
  });

  return proc;
}

describe('runClaude', () => {
  test('returns trimmed stdout on success', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ stdout: '  Hello!\n' })
    );
    const result = await runClaude('User: Hi');
    assert.equal(result, 'Hello!');
    mock.restoreAll();
  });

  test('rejects on non-zero exit code', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ exitCode: 1 })
    );
    await assert.rejects(runClaude('User: Hi'), /exited with code 1/);
    mock.restoreAll();
  });

  test('rejects on spawn error', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ errorMessage: 'ENOENT' })
    );
    await assert.rejects(runClaude('User: Hi'), /ENOENT/);
    mock.restoreAll();
  });
});
```

- [ ] **Step 2: Run the existing claude tests to confirm they still pass (before changing `src/claude.js`)**

```bash
node --test tests/claude.test.js
```

Expected: 3 tests pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add tests/claude.test.js
git commit -m "test: provide fresh credentials file in claude tests"
```

---

### Task 4: Integrate `ensureFreshCredentials()` into `src/claude.js`

**Files:**
- Modify: `src/claude.js`

- [ ] **Step 1: Update `src/claude.js`**

```javascript
const TIMEOUT_MS = 120000; // 2 minutes
const { ensureFreshCredentials } = require('./credentials');

async function runClaude(prompt) {
  await ensureFreshCredentials();

  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn('claude', ['--print', '--dangerously-skip-permissions'], {
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
      proc.kill('SIGKILL');
      settle(() => reject(new Error('claude timed out after 2 minutes')));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code, signal) => {
      settle(() => {
        if (code !== 0) {
          const detail = signal ? `killed by signal ${signal}` : `code ${code}: ${stderr.trim()}`;
          reject(new Error(`claude exited with ${detail}`));
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

- [ ] **Step 2: Run full test suite**

```bash
node --test tests/
```

Expected: all tests pass (credentials, claude, context), 0 failures.

- [ ] **Step 3: Commit**

```bash
git add src/claude.js
git commit -m "feat: call ensureFreshCredentials before each claude invocation"
```

---

### Task 5: End-to-end verification on the server

> ⚠️ **This task is for the human developer.** Do not push or deploy automatically.

- [ ] **Step 1: Push to remote and deploy**

```bash
git push
```

Then trigger a redeploy in the Coolify UI for the `claude-server` application. Wait for the container to become healthy.

- [ ] **Step 2: Manually expire the token on the server**

```bash
ssh root@116.202.179.253 "docker exec -u app m1ij3f0fl3ewbymp1imhn5zq-143319392444 node -e \"
  const fs = require('fs');
  const f = '/home/app/.claude/.credentials.json';
  const d = JSON.parse(fs.readFileSync(f));
  d.claudeAiOauth.expiresAt = Date.now() - 1;
  fs.writeFileSync(f, JSON.stringify(d));
  console.log('Token expired. expiresAt:', d.claudeAiOauth.expiresAt);
\""
```

- [ ] **Step 3: Send a message to the Discord bot**

Send any message in the configured Discord channel.

- [ ] **Step 4: Check container logs**

```bash
ssh root@116.202.179.253 "docker logs m1ij3f0fl3ewbymp1imhn5zq-143319392444 --tail 20"
```

Expected output includes:
```
Refreshing Claude credentials...
Claude credentials refreshed successfully
```

- [ ] **Step 5: Verify credentials file has updated `expiresAt`**

```bash
ssh root@116.202.179.253 "docker exec -u app m1ij3f0fl3ewbymp1imhn5zq-143319392444 node -e \"
  const d = JSON.parse(require('fs').readFileSync('/home/app/.claude/.credentials.json'));
  const msLeft = d.claudeAiOauth.expiresAt - Date.now();
  console.log('Expires in:', Math.round(msLeft / 1000 / 60 / 60), 'hours');
\""
```

Expected: expires in several hours (typically ~24).

- [ ] **Step 6: Confirm Discord bot responded correctly**

The bot should have replied normally, not with "Something went wrong."
