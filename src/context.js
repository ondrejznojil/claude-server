const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_ENTRIES = 40; // 20 turns × 2 (user + assistant)

function safeUserId(userId) {
  if (!/^\d+$/.test(userId)) throw new Error(`Invalid userId: ${userId}`);
  return userId;
}

function historyPath(userId) {
  return path.join(DATA_DIR, `${safeUserId(userId)}.json`);
}

function getHistory(userId) {
  const filePath = historyPath(userId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function appendMessage(userId, role, content) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let history = getHistory(userId);
  history.push({ role, content, timestamp: new Date().toISOString() });
  history = history.slice(-MAX_ENTRIES);
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
