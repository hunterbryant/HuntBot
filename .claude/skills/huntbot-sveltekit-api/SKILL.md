---
name: huntbot-sveltekit-api
description: SvelteKit API routes and server lib — env vars, SupportedRoutes, chat tool sync. Use when editing src/routes/api or src/lib/server.
---

# API and server

- Environment: `$env/dynamic/private` only (see [CLAUDE.md](CLAUDE.md) for variable names).
- New **navigable** destinations for HuntBot must be added to `SupportedRoutes` in [types.ts](src/lib/types.ts).
- New **chat tools** must stay in sync with the tool definitions used in [routes/api/chat/+server.ts](src/routes/api/chat/+server.ts) and any client handlers in MessageStore.
