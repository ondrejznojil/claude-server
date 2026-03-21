# Server Setup — Galadriel

The bot runs on the Galadriel server managed via Coolify.

## Persistent bind mounts

Two directories from the host are bind-mounted into the container. These survive container restarts and redeploys.

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `/workspace/` | `/workspace/` | Shared persistent workspace for files, projects, scripts |
| `/root/.ssh/` | `/root/.ssh/` | SSH keys and config — gives the bot SSH access |

### How to configure in Coolify

In the Coolify UI → Application `claude-server` → **Storages** → Add Storage:

- Type: **Bind Mount**
- Host path: `/workspace/`
- Container path: `/workspace/`

Repeat for `/root/.ssh/` → `/root/.ssh/`.

After adding, trigger a **Redeploy**.

## What the bot can do with full access

With `/root/.ssh/` mounted, the bot can:
- SSH into other servers
- Clone/push private git repos over SSH
- Run any SSH-based automation

With `/workspace/` mounted, the bot can:
- Persist files across sessions
- Share data between container restarts
- Store cloned repos, scripts, outputs

## Coolify application

- **App UUID:** `m1ij3f0fl3ewbymp1imhn5zq`
- **URL:** https://ondrej-claude.mdfx.cz
- **Health check:** https://ondrej-claude.mdfx.cz/health
- **Coolify UI:** https://coolify.galadriel.mdfx.cz
