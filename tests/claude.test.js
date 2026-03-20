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
    delete require.cache[require.resolve('../src/claude')];
    const { runClaude } = require('../src/claude');
    const result = await runClaude('User: Hi');
    assert.equal(result, 'Hello!');
    mock.restoreAll();
  });

  test('rejects on non-zero exit code', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ exitCode: 1 })
    );
    delete require.cache[require.resolve('../src/claude')];
    const { runClaude } = require('../src/claude');
    await assert.rejects(runClaude('User: Hi'), /exited with code 1/);
    mock.restoreAll();
  });

  test('rejects on spawn error', async () => {
    mock.method(require('child_process'), 'spawn', () =>
      makeMockProc({ errorMessage: 'ENOENT' })
    );
    delete require.cache[require.resolve('../src/claude')];
    const { runClaude } = require('../src/claude');
    await assert.rejects(runClaude('User: Hi'), /ENOENT/);
    mock.restoreAll();
  });
});
