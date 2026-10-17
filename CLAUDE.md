# CLAUDE.md — HuntBot

Personal portfolio site for product designer Hunter Bryant. Its core feature is **HuntBot**, an AI chatbot built into every page: it answers questions about Hunter's work with RAG (retrieval over a Qdrant index of his writing), can route visitors to pages, and has live tools (GitHub, calendar, training data). CMS-driven via **Prismic**, deployed to **Vercel**.

Detail lives in `docs/`; read the one that matches your task (links under [Where to read more](#where-to-read-more)).

## Stack

| Layer         | Technology                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App           | SvelteKit 2 + Svelte 5, TypeScript (strict), Tailwind CSS 3, pnpm, Node 22+ (Vercel runs 24; see `engines` in `package.json`)                                  |
| CMS           | Prismic (Slice Machine)                                                                                                                                        |
| LLM           | OpenAI `gpt-6.1-sol` (standard/deep lanes) and `gpt-6-luna` (quick lane + helper calls), via the Vercel AI SDK 7 (`ai`, `@ai-sdk/openai`) on the Responses API |
| Retrieval     | Qdrant Cloud (free tier), `text-embedding-3-small` at 512 dims, LangChain for embedding jobs, Cohere Rerank (optional)                                         |
| Observability | Vercel runtime logs, PostHog, LangSmith                                                                                                                        |
| Auth          | JWT cookie (`jsonwebtoken`)                                                                                                                                    |
| Deployment    | Vercel (`@sveltejs/adapter-vercel`); pushes to `main` deploy automatically                                                                                     |

## Commands

```bash
pnpm dev          # mprocs: vite dev + Slice Machine UI
pnpm check        # svelte-kit sync + type check: run before every commit
pnpm lint         # Prettier check + ESLint
pnpm format       # Prettier write
pnpm build        # production build
pnpm slicemachine # Slice Machine UI only
```

`src/prismicio-types.d.ts` is generated (by `pnpm check`); never edit it.

## File map

```
src/hooks.server.ts            auth guard: /admin pages, /api/embed/*, /api/admin/*
src/lib/types.ts               SupportedRoutes (valid navigation targets) and function-call names
src/lib/prismicio.ts           Prismic client + route config
src/lib/rewrite.ts             follow-up rewrite + HyDE draft (one structured call)
src/lib/analytics.ts           client PostHog events; src/lib/visitorContext.ts client visitor signals
src/lib/ChatBox/              chat UI; MessageStore.svelte.ts holds the AI SDK `Chat`, persistence, tool handlers
src/lib/utilities/context.ts   RAG retrieval (embed, Qdrant search, rerank, CONTEXT assembly, caches)
src/lib/server/               server-only helpers:
  auth.ts                      JWT cookie check (`authenticateUser`)
  query-lane.ts                quick/standard/deep lane classifier
  rerank.ts, rag-router.ts     rerank (Cohere or Decisions) and supplemental search planning
  grounding-score.ts, rag-reflection.ts   post-reply audits sent to PostHog
  chunk-audit.ts               quality + privacy tags on Qdrant chunks
  suggestion-check.ts          drops suggestion chips the conversation already answered
  qdrant-search.ts             low-level Qdrant client (named-vector aware)
  visitor-context.ts, ip-org.ts   visitor hints and the IPinfo network lookup
  github-repo.ts, calendar.ts  live GitHub and Google Calendar tools
  training.ts, python-sandbox.ts   intervals.icu data and the Vercel Sandbox Python runner
  notion.ts, self-docs.ts, job-match.ts   live Notion search, "how do you work" answers from our docs, job-posting matching
  company-roles.ts, safe-fetch.ts, tool-log.ts   open roles at a visitor's company, guarded fetch for visitor URLs, tool log lines
  timing.ts, posthog.ts, rag-debug.ts, warn-once.ts, model-errors.ts   timing, analytics capture, logging, failure classification
  imessage-config.ts, site-nav-routes.ts   iMessage toggle (cached in Qdrant), Prismic route catalog
src/lib/slices/                Prismic slices; index.ts registers them
src/routes/api/chat/           POST /api/chat (RAG + streaming) and its /suggestions, /proactive helpers
src/routes/api/embed/          indexing jobs (urls, notion-url, notion-file, texts), admin-only
src/routes/api/admin/          admin-only APIs (chunk audit, conversations)
src/routes/api/cron/qdrant-keepalive/   daily read that keeps the free Qdrant cluster alive
src/routes/{admin,login,case-studies,projects,information,slice-simulator}/
customtypes/                   Prismic custom type schemas
docs/                          detail docs; docs/site-story/ builds the Building HuntBot figures
```

## Environment variables

Set in `.env` locally or in the Vercel dashboard. Server code reads them via `$env/dynamic/private`. **Preview deployments only get the variables ticked for Preview**: if the Notion, calendar or intervals.icu tools say "not connected" on a preview, that variable isn't enabled for Preview (check the `[HuntBot tools]` / `[HuntBot training]` logs; production is unaffected).

```bash
OPENAI_API_KEY=            # chat, embeddings, helper calls
OPENAI_ASISTANT_ID=        # (sic, one "s") OpenAI Assistant ID
LANGCHAIN_API_KEY=         # LangSmith tracing
JWT_KEY=  AUTH_PASSWORD=  ADMIN_PASSWORD=   # cookie signing; visitor password (protected case studies); /admin password
QDRANT_URL=  QDRANT_API_KEY=  QDRANT_COLLECTION=
QDRANT_VECTOR_NAME=        # optional: dense vector name; auto-detected when unset
COHERE_API_KEY=            # optional: Rerank; without it reranking uses the OpenAI Decisions API
NOTION_INTEGRATION_TOKEN=  # content embedding
GOOGLE_CALENDAR_CLIENT_ID=  GOOGLE_CALENDAR_CLIENT_SECRET=  GOOGLE_CALENDAR_REFRESH_TOKEN=   # calendar.readonly OAuth
GOOGLE_CALENDAR_ID=        # optional (default "primary")
GOOGLE_CALENDAR_TIMEZONE=  # optional IANA zone (default America/Los_Angeles)
INTERVALS_API_KEY=  INTERVALS_ATHLETE_ID=   # intervals.icu training tools; unset means "not connected"
IPINFO_TOKEN=              # optional: IPinfo Lite for the visitor network lookup (also drives the open-roles hint)
POSTHOG_PROJECT_ID=  POSTHOG_PERSONAL_API_KEY=   # admin conversation views (read); PUBLIC_POSTHOG_API_KEY sends events
CRON_SECRET=               # authorizes Vercel Cron and the chunk audit's self-calls (16+ chars)
CHUNK_AUDIT_ORIGIN=        # optional: origin for the audit's follow-up calls (default https://huntbot.vercel.app)
CHUNK_AUDIT_USD_PER_M_INPUT=  # optional: gpt-6-luna input price for the audit cost estimate (default 0.10)
VITE_PRISMIC_ENVIRONMENT=  # optional: override the Prismic repository name

# Switches (defaults are on unless noted)
RAG_DEBUG=1                # log RAG/tool steps in production (dev logs them anyway)
RAG_REFLECTION=1           # off by default: structured PostHog audit of each reply
RAG_GROUNDING=0            # skip the per-turn grounding score
RAG_ROUTER=0               # skip the pre-turn search planner
RERANK_ENABLED=0           # skip reranking
SELF_CRITIQUE=0            # skip the context sufficiency check and fallback search
QUERY_LANES=0              # send every message down the standard pipeline
VISITOR_CONTEXT=0          # turn off visitor hints entirely
COMPANY_ROLES_WEB=0        # skip the background web search for a visitor company's open roles (job-board lookup stays)
```

## Rules that prevent real bugs

- **Env:** use `$env/dynamic/private`, never `process.env`. Never commit `.env`.
- **Routes:** add every new page to `SupportedRoutes` in `src/lib/types.ts` so HuntBot can navigate to it. Enums in `types.ts` are the source of truth for function-call names and routes.
- **Prompt caching:** the system prompt is a stable static prefix followed by one `## Live details` section. Anything that varies per turn (date, page, visitor hints, CONTEXT) goes in Live details, or the cache breaks. [chat-pipeline.md](docs/chat-pipeline.md)
- **Reasoning models:** set no `temperature`. `maxOutputTokens` includes reasoning tokens, so keep caps well above the visible reply length.
- **Stream errors:** never forward the model's `error` chunk to the client (the AI SDK client treats it as fatal and the visitor sees nothing). A turn always ends with text or a client tool; see "Never a silent turn".
- **Analytics:** server PostHog events go through `captureServerEvent` (`src/lib/server/posthog.ts`), post-reply work through `runInBackground`. Message text goes to PostHog only, never into always-on log lines. [observability.md](docs/observability.md)
- **Admin APIs:** new admin-only routes go under `/api/admin/` so `hooks.server.ts` guards them.
- **Visitor URLs and data:** tool output reaches anonymous visitors. Return only what is safe to show (the calendar tool returns titles and times only). Fetch any URL a visitor supplies with `safeFetchText` (`src/lib/server/safe-fetch.ts`), never bare `fetch`. [tools.md](docs/tools.md)
- **Slow lookups:** anything that can slow a reply (the open-roles lookup) races retrieval and is dropped for that turn if it loses; its result is cached for the next one.
- **Sandbox network policy regexes:** plain syntax only (no inline flags like `(?i)`); Vercel validates them with a JavaScript-compatible parser even though matching is RE2. [tools.md](docs/tools.md)
- **intervals.icu:** rides synced from Strava come back as empty stubs; weekly totals still count them.
- **Chat client:** `handleSubmit` ignores submits while a reply streams; two concurrent streams lose the first reply.
- **Voice:** HuntBot is not Hunter. It talks about him in the third person, in his voice; "I" is only ever the bot. Replies are 1–3 sentences of plain text. Persona comes entirely from the system prompt (voice rules, contrastive few-shot examples, banned AI-isms). For hiring questions, pitch in text first, then `capture_lead_intent` adds the contact card (`ActionMessage.svelte`).
- **Visitor hints:** use them only for emphasis, length and date math; never name the visitor's origin, location, device or language unprompted. The one exception: when the hints list open design roles at their company, HuntBot may ask once, as a question, whether they're hiring for one. [visitor-context.md](docs/visitor-context.md)
- **Prismic:** never edit `src/prismicio-types.d.ts`; regenerate with `pnpm check` after schema changes.

## CMS: Prismic + Slice Machine

Pages are composed of slices in `src/lib/slices/<Name>/` (`index.svelte`, `model.json`, `mocks.json`, `screenshot-*.png`). To add one: `pnpm slicemachine`, build it in the UI, register it in `src/lib/slices/index.ts`, then `pnpm check` to refresh the types.

| Prismic type     | Route                |
| ---------------- | -------------------- |
| `home`           | `/`                  |
| `case_study`     | `/case-studies/:uid` |
| `information`    | `/information`       |
| `other_projects` | `/projects`          |
| `project`        | `/projects/:uid`     |

## Auth

Cookie-based JWT signed with `JWT_KEY`. A visitor password (`AUTH_PASSWORD`) sets a `USER` role that unlocks protected case studies; `ADMIN_PASSWORD` sets `ADMIN` for `/admin`. Verified server-side by `authenticateUser(cookies)` in `src/lib/server/auth.ts`. `hooks.server.ts` redirects `/admin` pages to `/login` and returns 401 for `/api/embed/*` and `/api/admin/*` without an admin cookie; the one exception is `/api/admin/chunk-audit`, which also accepts `Authorization: Bearer $CRON_SECRET`. The hook checks the URL-decoded path, matching SvelteKit's routing, so `/%61dmin` can't slip past.

## Styling

Tailwind utilities everywhere (no CSS files beyond `app.css`, which loads the fonts). Fonts: Favorit (sans, primary) and Garamond (serif accents). Dark mode via `dark:` variants. Mobile-first; `sm:` (640px) switches to the desktop nav and chat layout. Palette: `stone-*` grays plus `blue-600` for interactive elements. Grid: 5 columns mobile, 6 `sm`, 7 `md`, 9 `lg`.

## Where to read more

- [docs/chat-pipeline.md](docs/chat-pipeline.md): lanes, retrieval, rerank, router, prompt assembly, streaming, suggestion chips, grounding score, client chat state. Read before changing `/api/chat`, `context.ts` or `ChatBox/`.
- [docs/tools.md](docs/tools.md): every model tool, the GitHub, calendar and training/sandbox tools, and their limits. Read before adding or changing a tool.
- [docs/visitor-context.md](docs/visitor-context.md): visitor hints and privacy rules (GPC, never-mention).
- [docs/knowledge-base.md](docs/knowledge-base.md): embedding sources, the chunk audit, the Qdrant keepalive.
- [docs/observability.md](docs/observability.md): log lines and PostHog events; read before adding either.
- [docs/site-story/README.md](docs/site-story/README.md): how the Building HuntBot page's figures are built and published.
