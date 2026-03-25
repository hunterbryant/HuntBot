---
name: huntbot-core
description: Core HuntBot conventions — read CLAUDE.md, minimal diffs, $env/dynamic/private on server. Use for any HuntBot or SvelteKit work in this repo.
---

# HuntBot (core)

- Read [CLAUDE.md](CLAUDE.md) for stack, env vars, and directory layout before larger changes.
- Prefer minimal, focused diffs; match existing patterns in nearby files.
- Server code: use `$env/dynamic/private` only (never `process.env`).
