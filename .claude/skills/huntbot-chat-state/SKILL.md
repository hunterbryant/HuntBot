---
name: huntbot-chat-state
description: ChatBox and MessageStore — single Chat, store unsubscribe, timer cleanup, pure messageUtils. Use when editing src/lib/ChatBox.
---

# ChatBox / MessageStore

- Use a **single shared** `Chat` for the session (`chat()` in [MessageStore.svelte.ts](src/lib/ChatBox/MessageStore.svelte.ts)); do not create a new `Chat` per component mount without an explicit reason.
- Any manual `store.subscribe` must be **unsubscribed** in `onDestroy` (or equivalent).
- When scheduling `setTimeout` for scroll or fetches, **clear** pending timers on teardown to avoid leaks and duplicate work.
- Pure message helpers live in [messageUtils.ts](src/lib/ChatBox/messageUtils.ts); keep them free of `$app/*`, `goto`, and analytics so they stay easy to test.
- After changing client tool handling, keep history consistent with the server (see `stripTrailingAssistantToolTurns` in messageUtils).
