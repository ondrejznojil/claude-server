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
