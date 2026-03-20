# Claude server

## Language
- Use English for all code, comments, and documentation.

## Development

Use `main` as the base branch for all feature work.

### Documentation

The `docs/` directory is your long-term memory. When starting a new context, read the docs relevant to what you're about to work on — they capture high-level knowledge about what things do and why, not implementation details.

- Write docs that help a future you understand the project quickly.
- Focus on the "what" and "why", not the "how" — code is the source of truth for implementation.
- Don't create docs for the sake of it. If a change is self-explanatory, skip it.
- API endpoint docs go in Swagger (separate concern).

### Before finalizing changes

1. **Update documentation** — If your changes affect what something does or how the project is structured, update the relevant doc in `docs/`. Only write what would help you (a future context) understand the project. Skip docs that don't feel useful. API endpoint documentation belongs in Swagger, not here.

### Git Workflow

- **Always commit your work.** After finishing a task and passing the checklist, create a commit immediately. Never leave uncommitted changes behind.
- Create **atomic commits** as you work — each commit should represent one logical change (a single feature, fix, refactor, or test addition). Do not bundle unrelated changes into one commit.
- Before every commit, run the full checklist from [Before finalizing changes](#before-finalizing-changes). Only commit when all 4 steps pass.
- **Never push to the remote.** Developers push manually after reviewing your commits.
- **Never add `Co-Authored-By` to commit messages.**

## Deployment

When working with Coolify, use .env variables COOLIFY_TOKEN and COOLIFY_URL.

**Do not make any changes in Coolify (API calls, deployments, configuration) unless explicitly asked by the user.**
