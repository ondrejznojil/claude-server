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
