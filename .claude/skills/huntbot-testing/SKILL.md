---
name: huntbot-testing
description: Vitest, CI expectations, pure helper coverage. Use when changing messageUtils, landing math, or *.test.ts files.
---

# Testing

- New or changed **pure** helpers in [messageUtils.ts](src/lib/ChatBox/messageUtils.ts) should have **Vitest** coverage in a colocated `*.test.ts` file.
- Run `pnpm test` before merging when you touch tested modules; CI runs `pnpm test`, `pnpm check`, and `pnpm lint`.
- Prefer the **node** test environment for pure logic (default in [vite.config.ts](vite.config.ts)). Avoid WebGPU/WebGL in CI.
