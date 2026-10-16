# CLAUDE.md — HuntBot Codebase Guide

## Project Overview

HuntBot is a personal portfolio website for product designer Hunter Bryant. Its core feature is **HuntBot**, an AI chatbot wired into the site that helps visitors explore Hunter's work. The bot uses a RAG (Retrieval Augmented Generation) pipeline to answer questions about Hunter's background and can navigate users to relevant pages via OpenAI function calling.

The site is CMS-driven via **Prismic** and deployed to **Vercel**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 3 (utility-first, dark mode via `dark:` variants) |
| CMS | Prismic (Slice Machine) |
| LLM | OpenAI `gpt-6.1-sol` (main chat, standard/deep lanes) + `gpt-6-luna` (quick lane + all helper calls) via the `openai` npm package |
| Vector DB | Qdrant Cloud (free tier, 1GB) |
| Embeddings | OpenAI `text-embedding-3-small`, 512 dimensions |
| RAG / retrieval | LangChain JS (`@langchain/openai`, `@langchain/qdrant`) |
| Streaming | Vercel AI SDK 7 (`ai` package) — `streamText` + `createUIMessageStream` + stateless `toUIMessageStream` |
| Observability | LangSmith (`langsmith`) for tracing RAG pipeline runs |
| Analytics | Vercel Analytics + Speed Insights |
| Auth | JWT (`jsonwebtoken`) stored as a cookie |
| Package manager | pnpm |
| Node version | 22+ (required by AI SDK 7; Vercel runs Node 24 — see `engines` in `package.json`) |
| Deployment | Vercel (`@sveltejs/adapter-vercel`) |
| Dev runner | `mprocs` — runs SvelteKit dev server + Slice Machine UI concurrently |

---

## Directory Structure

```
HuntBot/
├── src/
│   ├── app.html              # HTML shell
│   ├── app.css               # Global styles (custom fonts loaded here)
│   ├── app.d.ts              # SvelteKit global type augmentation
│   ├── hooks.server.ts       # SvelteKit server hooks (auth, etc.)
│   ├── prismicio-types.d.ts  # Auto-generated Prismic type definitions
│   ├── params/
│   │   └── preview.ts        # Prismic preview route matcher
│   ├── lib/
│   │   ├── prismicio.ts      # Prismic client factory + route config
│   │   ├── types.ts          # Core shared types (SupportedRoutes, SupportedActions, etc.)
│   │   ├── ChatBox/          # HuntBot chat UI components + state
│   │   │   ├── ChatBox.svelte        # Root chat widget
│   │   │   ├── MessageStore.svelte.ts # Svelte stores + Vercel AI SDK `Chat` setup
│   │   │   ├── TextInput.svelte
│   │   │   ├── UserMessage.svelte
│   │   │   ├── BotMessage.svelte
│   │   │   ├── ActionMessage.svelte  # Renders function-call action feedback
│   │   │   ├── GreetingMessage.svelte
│   │   │   └── LoadingStream.svelte
│   │   ├── nav/
│   │   │   ├── Links.svelte          # Nav link list
│   │   │   └── navstore.ts           # Svelte stores for nav/chat state
│   │   ├── server/
│   │   │   ├── auth.ts               # JWT cookie verification helper
│   │   │   ├── rerank.ts             # Chunk reranking — Cohere Rerank, or OpenAI Decisions without a Cohere key
│   │   │   ├── query-lane.ts         # Adaptive-compute lane classifier (quick / standard / deep)
│   │   │   ├── timing.ts             # Per-request stage timer for latency logging
│   │   │   ├── posthog.ts            # Server-side PostHog capture (waitUntil + failure logging)
│   │   │   ├── model-errors.ts       # Classifies a failed model call: unavailable (credits/auth) vs transient
│   │   │   ├── rag-router.ts         # Supplemental search planning via structured LLM call
│   │   │   ├── rag-reflection.ts     # Post-hoc grounding audit for PostHog
│   │   │   ├── grounding-score.ts    # Per-turn reply audit (OpenAI Decisions) for PostHog
│   │   │   ├── chunk-audit.ts        # In-place quality/privacy tags on Qdrant chunks (OpenAI Decisions)
│   │   │   ├── rag-debug.ts          # RAG logging helpers
│   │   │   ├── qdrant-search.ts      # Low-level Qdrant client + vector search
│   │   │   ├── imessage-config.ts    # iMessage feature toggle (cached in Qdrant)
│   │   │   └── site-nav-routes.ts    # Prismic route catalog with caching
│   │   ├── slices/                   # Prismic Slice Machine components
│   │   │   ├── index.ts              # Slice registry (maps slice names → components)
│   │   │   ├── ContentHighlight/
│   │   │   ├── EmbedBlock/
│   │   │   ├── Experience/
│   │   │   ├── Expertise/
│   │   │   ├── GridGap/
│   │   │   ├── ImageBlock/
│   │   │   ├── InfoEducationImage/
│   │   │   ├── Links/
│   │   │   ├── ProjectLink/
│   │   │   ├── Recognition/
│   │   │   └── TextBlock/
│   │   ├── utilities/
│   │   │   ├── context.ts            # RAG retrieval — MultiQueryRetriever via LangChain + Qdrant
│   │   │   ├── transition.ts         # Svelte crossfade transition helpers (send/receive)
│   │   │   └── urls.ts               # URL list for embedding
│   │   └── assets/                   # SVGs, fonts, images as Svelte components or raw files
│   └── routes/
│       ├── +layout.server.ts         # Global layout server load (auth state)
│       ├── +layout.svelte            # Root layout: nav, ChatBox, page transitions
│       ├── +page.server.ts / +page.svelte    # Home page
│       ├── +error.svelte             # Error page
│       ├── admin/                    # Admin panel for triggering embedding jobs
│       ├── api/
│       │   ├── chat/+server.ts       # POST — main chat endpoint (RAG + streaming)
│       │   ├── cron/
│       │   │   └── qdrant-keepalive/ # Daily Vercel Cron ping to keep the free Qdrant cluster active
│       │   └── embed/                # GET endpoints to trigger Qdrant embedding jobs
│       │       ├── urls/             # Recursively crawls hunterbryant.io
│       │       ├── notion-url/       # Embeds content from Notion via API
│       │       ├── notion-file/      # Embeds exported Notion markdown files
│       │       └── texts/            # Embeds local text/CSV files
│       ├── case-studies/             # Case study list + dynamic [uid] detail page
│       ├── information/              # About/info page
│       ├── login/                    # Login page (sets JWT auth cookie)
│       ├── projects/                 # Projects list + dynamic [uid] detail page
│       └── slice-simulator/          # Prismic Slice Machine simulator
├── customtypes/                      # Prismic custom type JSON schemas
├── slicemachine.config.json          # Slice Machine config (repositoryName, etc.)
├── tailwind.config.js                # Tailwind config (custom fonts: Favorit, Garamond)
├── svelte.config.js                  # SvelteKit config (adapter-vercel)
├── vite.config.ts
├── tsconfig.json
├── mprocs.yaml                       # Dev runner: sveltekit + slicemachine in parallel
├── .prettierrc                       # Prettier config
└── .eslintrc.cjs                     # ESLint config
```

---

## Development Workflow

### Starting development

```bash
pnpm dev
```

This uses `mprocs` to start two processes in parallel:
- `vite dev` — SvelteKit dev server
- `start-slicemachine` — Prismic Slice Machine UI (for content modeling)

### Other useful commands

```bash
pnpm build           # Production build
pnpm preview         # Preview production build locally
pnpm check           # TypeScript + Svelte type checking
pnpm check:watch     # Watch mode type checking
pnpm lint            # Prettier check + ESLint
pnpm format          # Auto-format with Prettier
pnpm slicemachine    # Start Slice Machine UI only
```

### Type checking is important

Always run `pnpm check` before committing. The project has strict TypeScript. The Prismic type definitions in `src/prismicio-types.d.ts` are auto-generated — do not edit manually.

---

## Environment Variables

All are required for full functionality. Set in `.env` locally or in Vercel dashboard for production.

```bash
OPENAI_API_KEY=          # OpenAI API key (chat completions + embeddings)
OPENAI_ASISTANT_ID=      # OpenAI Assistant ID (note: typo in var name — one 's')
LANGCHAIN_API_KEY=       # LangSmith API key for RAG pipeline tracing
JWT_KEY=                 # Secret key for signing/verifying JWT auth cookies
AUTH_PASSWORD=           # Password for site visitors to access protected case studies
ADMIN_PASSWORD=          # Password for /admin page access
QDRANT_URL=              # Qdrant Cloud cluster URL (e.g., https://xxx.cloud.qdrant.io:6333)
QDRANT_API_KEY=          # Qdrant Cloud API key
QDRANT_COLLECTION=       # Name of the Qdrant collection to use (e.g., huntbot)
QDRANT_VECTOR_NAME=      # Optional: dense vector name if the collection uses named vectors (fixes "Not existing vector name" from Qdrant). Auto-detected from collection config when unset.
CHUNK_AUDIT_ORIGIN=      # Optional: origin the background chunk audit calls to start its next run (default on production: https://huntbot.vercel.app, which skips Cloudflare)
CHUNK_AUDIT_USD_PER_M_INPUT= # Optional: gpt-6-luna input price (USD per 1M tokens) for the chunk audit's cost estimate (default 0.10, from third-party trackers; set the real rate when known)
CRON_SECRET=             # Random 16+ char secret authorizing Vercel Cron requests to /api/cron/* — set in the Vercel dashboard, Vercel auto-sends it as the cron job's Authorization header; the background chunk audit also uses it to start its own follow-up runs
NOTION_INTEGRATION_TOKEN= # Notion integration token for content embedding
GOOGLE_CALENDAR_CLIENT_ID=     # OAuth 2.0 client ID (Google Cloud Console — Calendar API enabled)
GOOGLE_CALENDAR_CLIENT_SECRET= # OAuth 2.0 client secret, same client as above
GOOGLE_CALENDAR_REFRESH_TOKEN= # Long-lived refresh token for Hunter's Google account, obtained once via an OAuth consent flow (e.g. OAuth 2.0 Playground) with the https://www.googleapis.com/auth/calendar.readonly scope
GOOGLE_CALENDAR_ID=            # Optional: calendar ID to query (default: "primary")
GOOGLE_CALENDAR_TIMEZONE=      # Optional: IANA timezone for resolving "today"/relative dates and displaying event times (default: "America/Los_Angeles")
RAG_DEBUG=               # Set to 1 to log RAG / agent tool steps in production (dev logs them by default)
RAG_REFLECTION=          # Set to 1 to run a structured PostHog audit (`rag_reflection` event: thinking, citations, confidence)
RAG_GROUNDING=           # Set to 0 to skip the per-turn grounding score (`rag_grounding` PostHog event, one OpenAI Decisions call after the reply streams; default = on)
RAG_ROUTER=              # Set to 0 to skip the pre-turn structured router (saves one small LLM call per message; default = router on)
COHERE_API_KEY=          # Cohere API key for Rerank (rerank-v4.0-fast). Optional — without it, reranking uses the OpenAI Decisions API instead
RERANK_ENABLED=          # Set to 0 to disable reranking of retrieved chunks (default: on). When enabled, 16 chunks are fetched and reranked to top 5.
SELF_CRITIQUE=           # Set to 0 to disable pre-generation context sufficiency check and fallback search (default: on)
QUERY_LANES=             # Set to 0 to disable adaptive-compute lanes and send every message down the standard pipeline (default: on)
IPINFO_TOKEN=            # Optional: IPinfo Lite token (free) for the reverse-IP network lookup. Without it there is no org lookup
VISITOR_CONTEXT=         # Set to 0 to turn off visitor hints entirely (arrival source, pages read, timezone, device, language, network). Default: on
```

The `VITE_PRISMIC_ENVIRONMENT` env var can optionally override the Prismic repository name used (useful for staging environments).

---

## Chat & RAG Pipeline

### How the chat pipeline works (`/api/chat`)

1. Client sends `POST /api/chat` with the full message history
   - **Adaptive-compute lanes** (`src/lib/server/query-lane.ts`): the message is embedded once and compared against quick/deep exemplar questions (nearest-neighbour cosine, no LLM call). **Quick** (overview/navigation, e.g. "tell me about him") skips HyDE, LLM rerank, the router and the fallback search, and answers with `gpt-6-luna`. **Standard** (default) runs the full pipeline on `gpt-6.1-sol` at low effort. **Deep** (open-ended/analytical) always runs the router and uses `gpt-6.1-sol` at medium effort with a bigger output budget. Trivial acknowledgements ("thanks", "ok") skip classification and retrieval entirely and use the quick model. Thresholds are conservative and should be tuned from the timing logs; disable with `QUERY_LANES=0`.
2. Server uses `getContext()` (`src/lib/utilities/context.ts`) to retrieve relevant docs:
   - **Query rewrite + HyDE expansion** (`src/lib/rewrite.ts`): HyDE (Hypothetical Document Embeddings) generates a brief hypothetical answer and concatenates it with the query to improve vector similarity for vague questions. First messages need no rewrite, so that's a single HyDE call. Follow-ups get the standalone rewrite *and* the HyDE answer from one structured `generateText` + `Output.object` call (previously two serial calls, 5–6s together). The quick lane skips HyDE. Every rewrite/HyDE call has a 2.5s timeout; on timeout, follow-ups fall back to the previous user turn + the new message as the search query.
   - Embeds with `text-embedding-3-small` (512 dims) — once per query, shared across branches — and queries Qdrant (`k=16` per branch: main site + optional iMessage + optional entity-filtered search), deduped and ordered by vector score
   - **Reranking** (`src/lib/server/rerank.ts`): over-retrieved 16 candidates are reduced to the top 5. With `COHERE_API_KEY` set, this uses Cohere's dedicated `rerank-v4.0-fast` cross-encoder through the AI SDK `rerank()` helper (`@ai-sdk/cohere`) — roughly 0.1–0.6s per call, with a 3s timeout. Without a Cohere key it uses OpenAI's experimental Decisions API (`experimental_decide` + `openai.decisionModel('gpt-6-luna')`): the candidates go into the decision state once as `excerpts` (whole chunks, up to 1,200 chars, so the sufficiency question sees the answer if it's there), with one `score` question per chunk plus one `boolean` question, `answers_question`, asking whether the candidates together answer the visitor's message (judged against their own words and earlier turns, not the HyDE-expanded query). `getContext` returns that probability alongside the CONTEXT text, and it's null on the Cohere path, when there are 5 or fewer candidates, or on failure. The call has a 4s timeout, so a slow Decisions API falls back to vector order instead of holding up the turn. Either way, any failure falls back to vector-score order. The quick lane skips reranking. Disable with `RERANK_ENABLED=0`.
   - **Source diversity filter**: max 2 chunks per unique source URL to avoid redundant context
   - **Entity-aware search**: queries mentioning a person name trigger an additional Qdrant search filtered on `metadata.contact` / `metadata.participants`
   - CONTEXT chunks are labeled with `[CHUNK-...]` ids for grounding
   - **Caching** (per warm serverless instance): full site-page text is cached for 30 min instead of re-fetching hunterbryant.io every turn, and first-turn CONTEXT is cached for 10 min keyed on lane + page + normalized message, so repeated opening questions (suggestion chips) skip rewrite, search and rerank
   - **Qdrant vector naming**: Retrieval uses `src/lib/server/qdrant-search.ts`, which matches LangChain’s embed shape. It reads the collection config and uses a **named** vector (`{ name, vector }`) when the collection defines named dense vectors (common for Qdrant Cloud / dashboard-created collections). Set `QDRANT_VECTOR_NAME` if auto-detection picks the wrong vector on multi-vector collections.
3. **RAG router** (`src/lib/server/rag-router.ts`, schema `src/lib/schemas/ragRouter.ts`): optional structured plan via `generateText` + `Output.object` + `gpt-6-luna` — up to **3 supplemental vector searches** (`searchKnowledgeBase` under the hood) when initial CONTEXT has a gap. When the Decisions reranker judged the candidates, a gap means `answers_question` < `CONTEXT_ANSWERS_THRESHOLD` (0.5), or empty CONTEXT. Otherwise (Cohere, quick lane, few candidates) it falls back to `assessConfidence`'s chunk-count heuristic: `empty` or `thin`. It no longer runs on `moderate` context — that added 1.3–4.7s to most standard turns; the model can still call `search_knowledge_base` itself. The deep lane always runs it. The router call has a 3s timeout. Results are appended as `PRE-RUN VECTOR SEARCHES` in the same CONTEXT block. Optional `assistant_hint` is injected above CONTEXT. Set `RAG_ROUTER=0` to disable.
4. **Context sufficiency check**: if CONTEXT has zero or one chunk, a fallback `searchKnowledgeBase` call appends broader results. Disable with `SELF_CRITIQUE=0`.
5. Retrieved context (including any pre-run and fallback searches) is injected into the system prompt alongside the full message history. The system prompt is written with a stable static prefix (voice/rules/tools, plus an `## ABOUT HUNTER` block holding the live `/information` page text so role/work history/links never depend on retrieval) and all turn-specific content (today's date, current page, approved routes, router hint, CONTEXT) pushed into a single `## Live details` section at the end, so OpenAI's automatic prompt caching can reuse the cached prefix across turns and visitors. A matching `providerOptions.openai.promptCacheKey` is set on the model call to keep those requests on the same cache partition.
6. OpenAI `gpt-6.1-sol` is called via the **Responses API** (`openai.responses(...)`, not the chat completions helper) with streaming + tools (Vercel AI SDK `streamText`). The Responses API is required to get reasoning summaries back for a reasoning model. `gpt-6.1-sol`/`gpt-6-luna` are reasoning models; no `temperature` is set anywhere in the pipeline; the AI SDK 7 top-level `reasoning` option is set instead (`'low'` for quick/standard lanes and every helper call, `'medium'` for the deep lane). AI SDK 7 defaults OpenAI reasoning summaries to `'detailed'` whenever `reasoning` is set, so the chat call pins `reasoningSummary: 'auto'` and helper calls pass `reasoningSummary: null`. `experimental_transform: smoothStream({ chunking: 'word' })` paces the token stream into natural word-sized chunks for the client instead of raw provider deltas.
7. Vercel AI SDK streams the response back to the client via `toUIMessageStream({ stream: result.stream })` inside `createUIMessageStream`. Reasoning summary deltas stream through as `reasoning` UI parts (`sendReasoning` defaults to `true`). The server also emits `source-url` UI parts for every distinct SITE CONTENT page URL that grounded the reply (parsed off the `[CHUNK-site-...] Source: <url>` lines in CONTEXT) — the client renders these as small linked citations under the bot message via `getMessageSources()` in `MessageStore.svelte.ts`.
   - **No dead ends**: if a reply admits a miss (`MISS_PATTERN`: "I don't have…", "not sure from…") and no client tool fired, the server attaches up to two related site pages as a `data-related` part before `finish` — pages retrieval already ranked for the question first, then a site-only vector search (`findRelatedSitePaths` in `context.ts`) when CONTEXT had none. Only when the visitor's message itself lands near site content (best public vector score ≥ `RELATED_MIN_SCORE`, 0.45, logged as `related_top_score` on `chat_message` for tuning); meta questions ("what do you know about me?") and topicless follow-ups ("show me those details") get no chips, since the closest page would be unrelated. The client renders them as page chips under the reply (`getMessageRelated()`), in place of the source citations. The same chips also go under a reply that names a project or case study by its title (`pagesNamedIn` in `site-nav-routes.ts`; section pages like "About" are excluded since their names are ordinary words), up to two, so visitors can tap through without HuntBot auto-routing them. The prompt tells the model chips appear on their own and to save `route_to_page` for explicit "take me to" asks.
8. LangSmith traces the full pipeline run (retrieval + LLM call) for observability
   - **Never a silent turn**: the model's UI stream is forwarded chunk-by-chunk rather than merged, and if a turn ends with no text and no client-visible tool call (e.g. reasoning used up the output budget, or the model call failed), a short fallback line is sent before `finish` and an `Model produced an empty reply` warning is logged. The model's `error` chunk is deliberately **not forwarded**: the AI SDK client treats it as fatal, stops reading, and the visitor would see nothing (the failure is still logged and sent as `model_error` / `model_failure`). `classifyModelFailure` (`src/lib/server/model-errors.ts`) sorts failures into `transient` (rate limit, timeout, provider 5xx) and `unavailable` (out of credits or quota, which OpenAI reports as a 429 with a billing message, plus 401/402/403/404). Transient ones get "Sorry, I blanked on that one — mind asking again?"; unavailable ones, where asking again would fail the same way, get `MODEL_UNAVAILABLE_TEXT` plus the Email/LinkedIn contact card, sent as a synthetic `capture_lead_intent` tool call that the client renders like the model's own. Note that `maxOutputTokens` includes reasoning tokens, so caps are set well above the length of a 1–3 sentence reply.
   - `gpt-6-*` models need `@ai-sdk/openai` ≥ 3.0.127 (now on 4.x with AI SDK 7) to be recognized as reasoning models — older versions silently drop reasoning settings (watch for `AI SDK Warning … not supported for non-reasoning models` in logs).
   - **Grounding score** (`src/lib/server/grounding-score.ts`): after every non-trivial reply, one OpenAI Decisions call scores how well the reply is supported by the CONTEXT, the ABOUT HUNTER page text and any server-tool output (`grounding`, 0–3, probability-weighted), and whether it makes factual claims at all (`makes_claims`, so misses and small talk can be filtered out). The same call also answers `speaks_as_hunter` (first-person slips against the "HuntBot is not Hunter" rule), `admits_miss` (misses in any wording, which `MISS_PATTERN` can't catch), `voice` (0–3 against the voice rules) and `visitor_intent` (recruiter / client / peer / curious / testing, with probabilities). A refusal on any question fails the whole call, which only drops that turn's event. It's sent as a separate `rag_grounding` PostHog event that joins to `chat_message` on `run_id`. It runs after the stream finishes, so it adds no visitor latency. Disable with `RAG_GROUNDING=0`.
   - **Suggestion chips** (`/api/chat/suggestions`) are written from the page text / transcript, then checked against the knowledge base: the model writes 5 candidates, each is embedded and matched against public sources (no iMessage), and any whose best vector score is under `MIN_VECTOR_SCORE` is dropped before the top 3 are shown, so a chip never leads straight to "I don't have that". After a reply, the prompt also includes the **last reply** and asks for chips about what it mentions but doesn't explain; a second check (`dropAlreadyAnswered` in `src/lib/server/suggestion-check.ts`, one OpenAI Decisions boolean per candidate, 3s timeout, fails open) drops any chip that reply or an earlier visitor question already answers (P ≥ 0.6). It runs in parallel with the vector check, and 6 candidates are written so 3 usually survive both. Navigation chips ("Take me to…") skip the check. Scroll-driven chip fetches are capped at 2 per page.
   - All structured helper calls (router, reflection, suggestions) use `generateText` + `Output.object` — `generateObject` is deprecated in AI SDK 7. The suggestion and proactive endpoints also go through the AI SDK rather than the raw `openai` client, and log failures instead of silently returning empty results.
9. **Latency logging** (`src/lib/server/timing.ts`): every turn logs one `[HuntBot timing]` JSON line (lane, model, lane scores, and ms per stage: `classify`, `rewrite`, `vector_search`, `rerank`, `page_fetch`, `retrieval`, `router`, `supplemental`, `fallback`, `model_start`, `first_token`, `total`, plus per model step `stepN` / `stepN_first_output` and per tool `tool_<name>` from AI SDK 7's `step.performance`) and attaches the same `timings_ms` + `lane` to the PostHog `chat_message` event
10. **PostHog `chat_message` event**: sent once per turn after the stream finishes (also when the pipeline throws). `bot_response` is what the visitor actually saw (including fallback lines, or a client tool's `message` when the model wrote no text). `related_pages` lists any related-page chips attached to a miss. It also carries `$ip` / `$raw_user_agent` (so PostHog doesn't geolocate to the Vercel region or label every turn as Automation traffic), `is_admin` (from the auth cookie, to filter out Hunter's own testing), `server_tools` / `server_tool_args`, `context_confidence` / `context_*_chunks`, `context_answers_question` (the Decisions reranker's sufficiency probability, or null), `router_ran`, `fallback_search_ran`, `empty_reply_fallback`, `model_error` and `pipeline_error`. Client events (`$pageview`, `suggestions_shown`, `suggestion_clicked` — both with `suggestion_type`: `starter` / `post_message` / `scroll` / `hover` / `placeholder` — `related_page_clicked`, `contact_clicked`, `not_helpful`) go through `src/lib/analytics.ts`, which adds the browser user agent and URL, and share the chat session id as `distinct_id`.

### Visitor context (`visitorContext.ts`, `server/visitor-context.ts`, `server/ip-org.ts`)

Each chat turn carries a few signals about the visitor so replies can adjust emphasis, length and date math. The model only ever sees short derived labels in a `## Visitor hints (internal)` block inside `## Live details` (so the static prompt prefix stays cacheable); it never sees the IP, user agent or raw URLs, and the context is deliberately kept out of retrieval and the first-turn context cache key.

- **Arrival**: the landing referrer (off-site only; `$referrer` on `$pageview` is overwritten by in-site navigation, so it's kept separately as `landing_referrer`) and a `?via=<slug>` / `?utm_source=` link tag, bucketed into `campaign:<slug>` / `linkedin` / `search` / `social` / `referral:<domain>` / `direct`. Most visits are `direct` (LinkedIn, Slack, iMessage and email strip the referrer), so tag the links Hunter sends with `?via=`. The tag is stripped from the address bar after it's read.
- **Pages read** this visit (last 10, with rough dwell time, current page excluded), **device** (phone vs desktop), **returning** visitor, and the visitor's **timezone** (so "yesterday" uses their date; calendar results stay in Hunter's timezone).
- **Server-derived**: browser language from `Accept-Language` (only when not English), country from `x-vercel-ip-country`, and the **network owner** from an IPinfo Lite lookup (800ms timeout, 1h in-memory cache, runs in parallel with retrieval). The lookup is classified `isp` / `mobile` / `hosting` / `org`; only `org` reaches the prompt, since "Comcast" isn't a company visiting.
- **Never-mention rule**: the static prompt tells the model to use hints only for emphasis, length and date math, never to name the visitor's origin, company, location, device or language unprompted, and to answer "what do you know about me?" honestly and generally. After each turn `replyMentionsOrg` checks whether the reply named the network when the visitor hadn't, recorded as `visitor_org_mentioned` on `chat_message` and a `[HuntBot visitor]` warning line (no message text).
- **Global Privacy Control** (`Sec-GPC: 1` or `navigator.globalPrivacyControl`): no IP lookup, no `$ip` / `$raw_user_agent` on any event, `$geoip_disable: true`, and only `gpc: true` is recorded instead of the `visitor_*` properties. In-prompt hints (device, timezone, pages, language) still work for the reply itself.
- All client values are re-validated server-side (slug and domain patterns, `Intl` timezone check, known site routes only). Kill switch: `VISITOR_CONTEXT=0`.

### Function calling

The LLM can invoke these client-visible functions:

| Function | Effect |
|---|---|
| `minimize_chat` | Minimizes the chat widget |
| `route_to_page` | Navigates the browser to a site page via SvelteKit's `goto()`. Meant as an extra after a text answer, not a replacement — the client keeps any text the model streamed before the call, and the visitor's current page is left out of the allowed routes |
| `reset_conversation` | Clears the conversation and its saved copy (`resetChat`). Only for a clear request ("start over"); typing `clear`, `/clear`, `reset`, `start over` or `new chat` does the same instantly on the client with no model call |

All valid route destinations are defined in `src/lib/types.ts` as the `SupportedRoutes` enum. **When adding new pages to the site, add the route to `SupportedRoutes` so HuntBot can navigate to it.**

Beyond the two client-visible actions above, the model also has server-executed tools it can call mid-turn (not surfaced in the UI as actions): `search_knowledge_base` (additional Qdrant lookups) and four GitHub self-awareness tools backed by `src/lib/server/github-repo.ts` — `read_github_file` reads a file live from the `hunterbryant/huntbot` repo via unauthenticated `raw.githubusercontent.com` (defaulting to `CLAUDE.md`); `get_recent_commits` fetches the latest commits (message/author/date); `get_repo_info` fetches repo age/size/stars/language breakdown; and `search_repo_code` searches file paths/contents for a keyword to find the right file before reading it. The commit/info/search tools go through GitHub's unauthenticated REST API (`api.github.com`, ~60 req/hr limit; code search is a tighter ~10 req/min). Together they let HuntBot answer technical questions about its own architecture and recent changes without a separate embedding/re-indexing step. Each tool's `execute` reports a specific `data-status` label (e.g. "Searching my code…", "Reading CLAUDE.md…") so the chat loading indicator reflects exactly what it's doing instead of a generic "thinking" phrase.

A fifth server-executed tool, `get_calendar_events` (`src/lib/server/calendar.ts`), answers "what was Hunter up to on [date]" style questions by querying Hunter's Google Calendar live via OAuth2 (refresh-token flow, no user login involved — see `GOOGLE_CALENDAR_*` env vars). It intentionally returns only event titles and times, never attendees, locations, or descriptions, since results are exposed to anonymous site visitors. Requires a one-time OAuth consent flow to mint `GOOGLE_CALENDAR_REFRESH_TOKEN`; without it configured, the tool degrades gracefully ("Calendar is not connected.") rather than erroring.

### Client-side chat state (`MessageStore.svelte.ts`)

- Uses the Vercel AI SDK `Chat` class from `@ai-sdk/svelte`
- Chat ID is hardcoded as `'uniquechatid'` — this keeps a single persistent conversation across navigations
- `botEngaged` and `minimized` are Svelte writable stores that control chat visibility
- Function call results are appended to the message list as `role: 'function'` messages
- **Persistence**: the conversation is saved to `localStorage` (`huntbot_chat_v1`: replies, source/related parts, the contact card; last 50 messages; never the greeting, status parts or tool rows) when a turn settles and after each client tool call, and restored on load. It expires after 7 days, as does the session id (`huntbot_session_id`, also in `localStorage`, so a resumed chat keeps one PostHog session). A restored chat starts with the bar minimized (`botEngaged` true), skips the reveal animation (`restoredMessageIds`), and fetches fresh suggestion chips on first open. All storage access is try/catch since it can be blocked.
- **Links in the chat** (`BotMessage.svelte`): on mobile, tapping a related-page chip or a same-site source citation minimizes the chat so the page is readable. Same-site citations open in the same tab. The model's own `route_to_page` leaves the chat open.

---

## Embedding / Knowledge Base

The Qdrant vector collection is the knowledge base for HuntBot. It is populated by hitting admin endpoints (protected, requires admin auth).

### Embedding sources

| Endpoint | Source | Notes |
|---|---|---|
| `GET /api/embed/urls` | Recursive web crawl of `hunterbryant.io` | Max depth 3 |
| `GET /api/embed/notion-url` | Notion pages via API | Uses `NOTION_INTEGRATION_TOKEN` |
| `GET /api/embed/notion-file` | Local `local_files/notion_export/` directory | Dev-only button in admin UI |
| `GET /api/embed/texts` | Local text/CSV files | Dev-only button in admin UI |

All embedders use:
- Model: `text-embedding-3-small`
- Dimensions: `512`
- Chunk size: `1000` characters, overlap: `200`
- LangChain `QdrantVectorStore.fromDocuments()`

### Chunk audit (quality + privacy tags, no re-embedding)

`src/lib/server/chunk-audit.ts` tags every chunk with `metadata.audit` using OpenAI Decisions (8 chunks per call): a `substance` score (0–3, boilerplate → rich), and for notes/iMessage chunks a `sensitive` probability (contact details, financial/medical/legal details, credentials, private details about other people). The tags are written in place with Qdrant `set_payload`, so vectors are never touched and nothing needs re-embedding. It's started by hand and runs in the background: the **Audit** button under Quality on `/admin/embeddings` calls `POST /api/admin/chunk-audit` (admin cookie required), which returns immediately and tags whatever isn't tagged at the current `CHUNK_AUDIT_VERSION` after the response (`waitUntil` from `@vercel/functions`, up to 240s per run, `maxDuration: 300`). If untagged chunks remain, each run calls the endpoint again to start the next one, authorized with `CRON_SECRET` since the admin's login cookie expires after an hour (plus `VERCEL_AUTOMATION_BYPASS_SECRET`, sent on a retry, to get through Deployment Protection on previews). On production that call goes to `https://huntbot.vercel.app`, not hunterbryant.io: the custom domain is proxied through Cloudflare, whose bot challenge answers server-to-server requests with a 403 "Just a moment…" page. Set `CHUNK_AUDIT_ORIGIN` to override the target if the project's vercel.app alias ever changes. A refused call's error shows Vercel's `x-vercel-error` / `x-vercel-mitigated` / `server` headers and the start of the body. Progress is saved after every run in a `_config` point in Qdrant, like the iMessage toggle, so the admin page shows running / finished / failed with counts whenever it's opened. Vercel stops a chain of self-calls after about six hops (508 `INFINITE_LOOP_DETECTED`); that's why each run is long, and when it happens the job is marked **paused**, not failed. The admin page resumes a paused job on its own while it's open (a browser request starts a fresh chain), or **Resume** continues it later, keeping its start time and totals. A `running` status that hasn't updated in 6 minutes shows as stopped and also gets **Resume**. Each run stops starting new batches at 240s and aborts any call still in flight at 248s, so it always has time to save progress and start the next run before the 300s function limit; chunks it didn't reach stay untagged for the next run. Start failures (including an expired admin login) show in red under the button. Run it after indexing so new chunks get checked too; until then they're simply kept. The admin page also shows a **cost estimate** (`estimateAuditCost`): the collection's chunk count and how many are still untagged, priced at the current job's measured input tokens per chunk (or ~1,076, measured on the first production run, until the job has its own figure) times `CHUNK_AUDIT_USD_PER_M_INPUT`. Output tokens are left out; Decisions answers are a few tokens per question. Bump `CHUNK_AUDIT_VERSION` after changing the rubric to re-audit everything.

Retrieval (`searchByEmbedding` in `context.ts`) drops chunks flagged `low_value` (substance < 0.75) or `sensitive` (probability ≥ 0.8) right after each Qdrant search. That's done in code rather than as a Qdrant filter, so retrieval never depends on an audit index existing, and untagged chunks are always kept. Each search fetches 8 extra results so excluded chunks don't shrink the top-k. Refused chunks are tagged `refused: true` and kept. A run logs one `[HuntBot chunk audit]` line with counts.

### Keeping the free Qdrant cluster alive

Qdrant Cloud's free tier auto-suspends a cluster after 1 week of inactivity and deletes it after 4 weeks if it's not reactivated — this has already happened once to this project. Qdrant doesn't publicly document what counts as "activity," so relying on organic site traffic (visitors triggering chat → vector search) isn't reliable, since a low-traffic personal portfolio site can go days without a single chat query.

`vercel.json` schedules a daily Vercel Cron job (`GET /api/cron/qdrant-keepalive`) that runs a real `scroll` read against the collection — genuine data-plane traffic, not just a metadata/health-check call — well within the 1-week suspension window with margin to spare. The endpoint is secured with `CRON_SECRET` per [Vercel's cron job pattern](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs): set a random 16+ char value for `CRON_SECRET` in the Vercel dashboard and Vercel automatically sends it as the request's `Authorization: Bearer` header. Vercel's Hobby plan caps cron frequency at once/day; that's already ~7x margin under the suspension threshold.

---

## Observability

Everything worth reflecting on later lands in two places: **Vercel runtime logs** (one structured JSON line per thing, greppable by prefix) and **PostHog** events (joined on `run_id` per chat turn, `session_id` per conversation). Message text goes to PostHog only, never into the always-on log lines, and the chunk audit never sends chunk text anywhere, only ids.

**Server-side PostHog events must go through `captureServerEvent` in `src/lib/server/posthog.ts`.** It registers the request with Vercel's `waitUntil`, so events sent after the response (and the post-reply audits that produce them, via `runInBackground`) aren't lost when the function is frozen, and it logs a `[HuntBot analytics]` line when a send fails instead of swallowing it. The post-reply grounding and reflection calls only run when `PUBLIC_POSTHOG_API_KEY` is set (`isAnalyticsEnabled()`), since their results only go to PostHog. Grounding sees the start and the end of CONTEXT when it's over 12k chars, so router and fallback search results (appended last) aren't cut.

### Vercel log lines

| Prefix | When | What's in it |
|---|---|---|
| `[HuntBot timing]` | Every chat turn | Lane, model, lane scores, ms per stage, `rerank_engine`, `rerank_failed`, `answers_question`, `router_gate`, `router_ran`, `retrieval_failed`, `model_failure`, `excluded_by_audit` |
| `[HuntBot grounding]` | Every audited reply | `run_id`, grounding / voice scores, miss and first-person probabilities, `visitor_intent`, `decision_ms`, `input_tokens`; or `error` + `refused` |
| `[HuntBot chunk audit]` | Each ~45s audit run, plus `started` / `finished` / `failed` | Counts overall and `bySource` (site / notes / imessage), `inputTokens`, `durationMs`, and `flagged` (id, source, reason, scores, up to 100 per run) for spot-checking in Qdrant |
| `[HuntBot analytics]` | A PostHog send failed | `event`, HTTP `status` or `error` |
| `[AUTH] Denied admin API` | A request to `/api/embed/*` or `/api/admin/*` without admin auth | `method`, `path`, `role` |
| `[HuntBot RAG]` | Only in dev or with `RAG_DEBUG=1` | Step-by-step retrieval / rerank / tool detail |

### PostHog events

| Event | Sent by | Key properties |
|---|---|---|
| `chat_message` | Chat endpoint, once per turn | See pipeline step 10, plus `visitor_arrived_via`, `visitor_via`, `visitor_device`, `visitor_timezone`, `visitor_language`, `visitor_country`, `visitor_org`, `visitor_org_class`, `visitor_pages_seen`, `visitor_returning`, `visitor_org_mentioned` (all dropped under GPC, which records only `gpc: true`), `rerank_engine`, `rerank_failed`, `rerank_input_tokens`, `router_gate` (`deep_lane` / `decisions` / `heuristic`), `context_answers_question`, `context_excluded_by_audit` (chunks that would have made the top-k), `context_cache_hit` (repeat first-turn question served from cache; its rerank tokens are not counted again), `retrieval_error`, `model_failure` (`unavailable` = out of credits / bad key / no access, `transient` = rate limit or provider error, null = fine) |
| `rag_grounding` | Post-reply Decisions audit | `grounding_score`, `makes_claims_probability`, `speaks_as_hunter_probability`, `admits_miss_probability`, `voice_score`, `visitor_intent` (+ probabilities), `decision_ms`, `decision_input_tokens`, `grounding_error`, `grounding_refused`, `is_admin` |
| `rag_reflection` | Optional (`RAG_REFLECTION=1`) | `rag_thinking`, `rag_citations`, `rag_confidence` |
| `chunk_audit_run` | Each audit run | Counts, `by_source`, `input_tokens`, `duration_ms`, `more` |
| `chunk_audit_finished` / `chunk_audit_failed` | End of an audit job | Job totals, `duration_ms`, `input_tokens`; `error` on failure |
| Client events | `src/lib/analytics.ts` | `$pageview`, `suggestions_shown`, `suggestion_clicked`, `related_page_clicked`, `contact_clicked`, `not_helpful` |

Chunk audit events use `distinct_id: huntbot-system` with `$process_person_profile: false`, so they don't create a fake person. Filter `is_admin = true` out of chat analytics to drop Hunter's own testing.

## CMS: Prismic + Slice Machine

### How content is structured

Pages are composed of **slices** — modular content blocks defined in `src/lib/slices/`. Each slice has:
- `index.svelte` — the Svelte component
- `model.json` — the Prismic data model schema
- `mocks.json` — mock data for Slice Machine simulator
- `screenshot-*.png` — preview screenshots

### Adding a new slice

1. Run `pnpm slicemachine` and use the Slice Machine UI to create/edit slices
2. The component will be scaffolded in `src/lib/slices/<SliceName>/`
3. Register it in `src/lib/slices/index.ts`
4. Update `src/prismicio-types.d.ts` by running `pnpm check` (triggers `svelte-kit sync`)

### Route types in Prismic

| Prismic type | SvelteKit route |
|---|---|
| `home` | `/` |
| `case_study` | `/case-studies/:uid` |
| `information` | `/information` |
| `other_projects` | `/projects` |
| `project` | `/projects/:uid` |

---

## Authentication

The site uses a simple cookie-based JWT auth system:

- **Visitor auth** (`AUTH_PASSWORD`): Unlocks protected case studies. Sets a `role: USER` JWT cookie.
- **Admin auth** (`ADMIN_PASSWORD`): Unlocks `/admin`. Sets a `role: ADMIN` JWT cookie.
- Auth is verified server-side in `src/lib/server/auth.ts` via `authenticateUser(cookies)`.
- `hooks.server.ts` guards the admin surface: `/admin` pages redirect to `/login`, and the API routes those pages call (`/api/embed/*`, `/api/admin/*`) return 401 without an admin cookie. The one exception is `/api/admin/chunk-audit`, which also accepts `Authorization: Bearer $CRON_SECRET` so the background audit can start its own follow-up runs. The hook checks the URL-decoded path, matching SvelteKit's routing, so `/%61dmin` can't slip past the prefix checks. **New admin-only API routes go under `/api/admin/`** to be covered automatically.
- The JWT is signed with `JWT_KEY`.

---

## Styling Conventions

- **Tailwind utility classes** everywhere — no separate CSS files beyond `app.css` (which loads custom fonts)
- **Custom fonts**: `Favorit` (sans-serif, primary), `Garamond` (serif, italics/accents)
- **Dark mode**: Use `dark:` Tailwind variants. The site supports system dark mode.
- **Responsive**: Mobile-first. Key breakpoint is `sm:` (640px) which switches from mobile to desktop nav/chat layout.
- **Color palette**: Primarily `stone-*` grays + `blue-600` for interactive elements
- **Layout grid**: 5-column mobile / 6-column sm / 7-column md / 9-column lg

---

## Key Conventions

### SvelteKit patterns used
- `+page.server.ts` for data loading (Prismic queries run server-side)
- `+layout.server.ts` for auth state passed to all pages
- `$lib/` alias maps to `src/lib/`
- `$env/dynamic/private` for all server-side environment variables (never `process.env`)

### TypeScript
- Enums in `src/lib/types.ts` are the source of truth for function call names and valid routes
- Prismic types in `src/prismicio-types.d.ts` are auto-generated — always regenerate after schema changes

### HuntBot voice
- System prompt includes contrastive few-shot examples that define Hunter's speaking style
- No `temperature` param is set (the main model, `gpt-6.1-sol`, is a reasoning model); persona consistency comes entirely from the system prompt
- Responses default to 1-3 sentences, plain text, no markdown
- Anti-patterns (corporate jargon, chatbot pleasantries) are explicitly banned in the prompt
- See the `## How Hunter talks` and `## Voice examples` sections in the system prompt for the full voice spec
- **HuntBot is not Hunter.** It talks *about* him in the third person, in his voice; "I" is only ever the bot. Visitors who address Hunter directly ("how do you work?") get answers about him. The voice examples are Hunter's phrasings retold in the third person, and the suggestion and proactive-opener prompts follow the same rule (never "you/your" for Hunter)
- **Pitch before the contact card**: hiring/availability/"why hire him" questions get a real text answer first, then `capture_lead_intent` adds Email/LinkedIn buttons under it (`ActionMessage.svelte`, tracked as `contact_clicked`). Availability comes from the `/information` page text, so update that page to change what HuntBot says about it

### Do not
- Use `process.env` — use `$env/dynamic/private` instead
- Edit `src/prismicio-types.d.ts` manually
- Add hardcoded route strings without updating `SupportedRoutes` in `types.ts`
- Commit `.env` files

---

## Deployment

The project deploys automatically to **Vercel** on push to `main`. The adapter is `@sveltejs/adapter-vercel`. No special build configuration is required beyond setting environment variables in the Vercel dashboard.
