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
    // Patch setTimeout to skip the 2s retry delay.
    // Note: this also makes the AbortController's 10s timer fire immediately,
    // so mock fetch functions in these tests must NOT have any async delay —
    // the abort timer would fire and override the expected error.
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
    // Patch setTimeout to skip the 2s retry delay.
    // Note: this also makes the AbortController's 10s timer fire immediately,
    // so mock fetch functions in these tests must NOT have any async delay —
    // the abort timer would fire and override the expected error.
    globalThis.setTimeout = (fn, _delay) => origSetTimeout(fn, 0);
    try {
      await assert.rejects(ensureFreshCredentials(), /Token refresh failed: 503/);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
    assert.equal(calls, 2);
  });

  it('does NOT retry on timeout', async () => {
    writeCredsFile(credsFile, { expiresAt: Date.now() - 1 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      // Simulate a hanging request that triggers the AbortController
      await new Promise((_, reject) => setTimeout(() => {
        const err = new Error('Token refresh timed out');
        err.name = 'AbortError';
        reject(err);
      }, 0));
    };

    const { ensureFreshCredentials } = require('../src/credentials');
    await assert.rejects(ensureFreshCredentials(), /Token refresh timed out/);
    assert.equal(calls, 1, 'should not retry on timeout');
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
