---
name: huntbot-workflows
description: Multi-step workflows for HuntBot (new chat tool, new route, embed endpoint). Use when adding navigation tools, SupportedRoutes, Prismic slices, or embed API routes.
---

# HuntBot workflows

## Add a HuntBot navigation tool

1. Add the route to `SupportedRoutes` in [`src/lib/types.ts`](src/lib/types.ts) if it is a new page.
2. Register the tool schema and handler in [`src/routes/api/chat/+server.ts`](src/routes/api/chat/+server.ts).
3. Handle the tool in [`src/lib/ChatBox/MessageStore.svelte.ts`](src/lib/ChatBox/MessageStore.svelte.ts) (`handleToolCall`) if the client should show UI or call `goto`.
4. Verify: `pnpm test`, `pnpm check`, manual chat (tool runs, navigation works).

## Add a Prismic slice

1. Create or edit the slice in Slice Machine (`pnpm slicemachine`).
2. Register the component in [`src/lib/slices/index.ts`](src/lib/slices/index.ts).
3. Run `pnpm check` to refresh types.
4. Verify: slice renders on target page and in simulator.

## Add an embed source

1. Add a route under [`src/routes/api/embed/`](src/routes/api/embed/) following existing patterns (auth, chunking, Qdrant).
2. Document any new env vars in [`CLAUDE.md`](CLAUDE.md).
3. Verify: admin UI or `curl` against the endpoint in dev with valid admin auth.
