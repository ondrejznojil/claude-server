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
    if ((err.status && err.status >= 400 && err.status < 500) || err.message === 'Token refresh timed out') throw err; // no retry on 4xx or timeout
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
