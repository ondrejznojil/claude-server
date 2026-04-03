# Claude OAuth Token Auto-Refresh

## Context

The Claude Code CLI authenticates via OAuth tokens stored in `/home/app/.claude/.credentials.json`. Access tokens expire roughly every 24 hours. When they expire, `claude` exits silently with code 1, causing the Discord bot to reply "Something went wrong." The refresh token has a much longer lifespan and can be used to obtain new access tokens automatically.

The goal is to refresh the access token proactively before it expires, so the bot never fails due to stale credentials.

## Credentials file format

Confirmed from the running container:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1775272507467,
    "scopes": ["user:file_upload", "user:inference", "user:mcp_servers", "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "pro",
    "rateLimitTier": "default_claude_ai"
  }
}
```

`expiresAt` is a Unix timestamp in **milliseconds**.

## Design

### New file: `src/credentials.js`

Exports a single function `ensureFreshCredentials()`.

**Concurrent refresh protection:** a module-level promise is stored when a refresh is in progress. If `ensureFreshCredentials()` is called again while a refresh is already running, it returns the same in-progress promise (promise coalescing) instead of starting a second request.

**Logic:**
1. If a refresh is already in progress, await that promise and return.
2. Read `/home/app/.claude/.credentials.json`.
3. If `expiresAt - Date.now() >= 5 * 60 * 1000` (more than 5 min remaining), return — token is still fresh.
4. Otherwise, start refresh. Store the in-progress promise at module level.
5. POST to `https://platform.claude.com/v1/oauth/token` with a **10s timeout**:
   ```json
   {
     "grant_type": "refresh_token",
     "refresh_token": "<current refreshToken>",
     "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
   }
   ```
6. On HTTP/network error: wait 2s, retry once. On second failure: clear in-progress promise, throw descriptive error.
7. On success: build updated credentials object, write atomically (write to `.credentials.json.tmp` then `fs.rename`), clear in-progress promise.

**Mapping refresh response to file fields:**
- `response.access_token` → `claudeAiOauth.accessToken`
- `response.refresh_token` → `claudeAiOauth.refreshToken`
- `Date.now() + response.expires_in * 1000` → `claudeAiOauth.expiresAt`
- All other fields (`scopes`, `subscriptionType`, `rateLimitTier`) are preserved from the existing file.

### Modified: `src/claude.js`

Add one line before spawning the CLI:

```js
await ensureFreshCredentials();
```

If refresh fails, the error propagates to `bot.js`, which catches it and replies "Something went wrong. Please try again." — existing behavior is preserved.

### No changes to

- `bot.js`
- `entrypoint.sh`
- `Dockerfile`

## Token endpoint details

Discovered by inspecting the Claude Code CLI binary (`@anthropic-ai/claude-code@2.1.91`):

| Field | Value |
|---|---|
| URL | `https://platform.claude.com/v1/oauth/token` |
| Method | POST |
| Content-Type | `application/json` |
| `client_id` | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Response fields | `access_token`, `refresh_token`, `expires_in` (seconds) |

## Error handling

| Scenario | Behavior |
|---|---|
| Credentials file missing | Throw: `Credentials file not found` |
| File malformed | Throw: `Invalid credentials format` |
| Token still valid (>5 min) | No-op |
| Concurrent refresh in progress | Await shared promise, return |
| Refresh succeeds | Write atomically, continue |
| Refresh fails (1st attempt) | Wait 2s, retry |
| Refresh fails (2nd attempt) | Throw: `Token refresh failed: <status> <message>` |
| Request hangs | 10s timeout, treated as failure |

## Verification

1. SSH into server, set `expiresAt` to `Date.now() - 1` in `/home/app/.claude/.credentials.json` (expire the token):
   ```bash
   docker exec -u app <container> node -e "
     const fs = require('fs');
     const f = '/home/app/.claude/.credentials.json';
     const d = JSON.parse(fs.readFileSync(f));
     d.claudeAiOauth.expiresAt = Date.now() - 1;
     fs.writeFileSync(f, JSON.stringify(d));
     console.log('expired');
   "
   ```
2. Send a message to the Discord bot.
3. Check container logs — should see `Refreshing Claude credentials...` and then a normal response.
4. Verify the credentials file has an `expiresAt` in the future.
