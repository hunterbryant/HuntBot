# Tool evals

`scripts/eval/run.mjs` sends real questions to a running deployment's `/api/chat` and checks which tools the model called, what they returned and what it said. It exists because unit tests against fakes only prove a tool does what its author assumed; the Notion date failures (dates in titles, a fuzzy database match, an assumed year) all passed fakes.

```bash
EVAL_BASE_URL=https://<preview>.vercel.app EVAL_CRON_SECRET=<CRON_SECRET> pnpm eval
pnpm eval --group notion          # notion | calendar | training | self | jobs | routing
pnpm eval --id notion-last-week-sept --verbose   # prints every tool call and its output
```

- `EVAL_BASE_URL` (required): the deployment to hit. It uses real models and Hunter's real data, so it costs tokens; run it occasionally on a preview (before merging a big tool or prompt change), not after every edit and not in CI.
- `EVAL_CRON_SECRET`: the deployment's `CRON_SECRET`. Sent as `x-huntbot-eval`; the chat route then treats the turn as admin traffic (`is_admin`), so PostHog ignores it.
- `EVAL_BYPASS_SECRET`: the project's Deployment Protection automation bypass secret, for previews behind Vercel auth.
- Exit code 1 if any case fails.

## Cases (`scripts/eval/cases.json`)

Each case has `turns` (user messages sent in order, with the earlier replies as history) and checks on the last turn:

| Field                                  | Meaning                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `calls`                                | tools that must be called (`{tool, input?}`; `input` values are regexes)  |
| `forbidCalls`                          | tools that must not be called (routing: portfolio questions skip Notion)  |
| `outputIncludes`                       | regexes that must match some tool output (the tool really fetched data)   |
| `replyIncludes` / `replyIncludesAny`   | regexes the reply must match (all / at least one)                         |
| `replyExcludes`                        | regexes the reply must not match ("not connected", "different year", ...) |
| `maxRejectedCalls` / `maxToolCalls`    | robustness: how many bad tool calls and total calls are tolerated (1, 6)  |

Checks are deliberately about behavior (right tool, no dead end, no assumed year), not Hunter's private facts, so cases don't rot when the data changes. A reply that says "not connected" on a preview usually means the env var isn't ticked for Preview, not a code bug.

**Every miss seen in production becomes a case.** Add it before fixing it, watch it fail, then fix.
