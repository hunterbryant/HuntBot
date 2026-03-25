---
name: huntbot-explore
description: Forked read-only codebase exploration for HuntBot. Use when you need a deep map of files and patterns before changing code.
context: fork
agent: Explore
---

Explore the HuntBot repo for the user’s question ($ARGUMENTS):

1. Find relevant files with search tools (glob, grep).
2. Read key implementations; note paths and how they connect (chat API, MessageStore, RAG, slices).
3. Summarize with concrete file references and any gotchas from [CLAUDE.md](CLAUDE.md) or `.claude/skills/`.
