# CLAUDE.md — HuntBot Codebase Guide

## Project Overview

HuntBot is a personal portfolio website for product designer Hunter Bryant. Its core feature is **HuntBot**, an AI chatbot wired into the site that helps visitors explore Hunter's work. The bot uses a RAG (Retrieval Augmented Generation) pipeline to answer questions about Hunter's background and can navigate users to relevant pages via OpenAI function calling.

The site is CMS-driven via **Prismic** and deployed to **Vercel**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit 2 + Svelte 4 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 3 (utility-first, dark mode via `dark:` variants) |
| CMS | Prismic (Slice Machine) |
| LLM | OpenAI `gpt-3.5-turbo` via the `openai` npm package |
| Vector DB | Qdrant Cloud (free tier, 1GB) |
| Embeddings | OpenAI `text-embedding-3-small`, 512 dimensions |
| RAG / retrieval | LangChain JS (`@langchain/openai`, `@langchain/qdrant`) |
| Streaming | Vercel AI SDK (`ai` package) — `OpenAIStream` + `StreamingTextResponse` |
| Observability | LangSmith (`langsmith`) for tracing RAG pipeline runs |
| Analytics | Vercel Analytics + Speed Insights |
| Auth | JWT (`jsonwebtoken`) stored as a cookie |
| Package manager | pnpm |
| Node version | 20.x (required, see `engines` in `package.json`) |
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
│   │   │   ├── MessageStore.ts       # Svelte stores + Vercel AI SDK useChat() setup
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
│   │   │   ├── rerank.ts             # LLM-based chunk reranking (over-retrieve → rerank → top K)
│   │   │   ├── rag-router.ts         # Supplemental search planning via structured LLM call
│   │   │   ├── rag-reflection.ts     # Post-hoc grounding audit for PostHog
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
NOTION_INTEGRATION_TOKEN= # Notion integration token for content embedding
RAG_DEBUG=               # Set to 1 to log RAG / agent tool steps in production (dev logs them by default)
RAG_REFLECTION=          # Set to 1 to run a structured PostHog audit (`rag_reflection` event: thinking, citations, confidence)
RAG_ROUTER=              # Set to 0 to skip the pre-turn structured router (saves one small LLM call per message; default = router on)
RERANK_ENABLED=          # Set to 0 to disable LLM reranking of retrieved chunks (default: on). When enabled, 16 chunks are fetched and reranked to top 5.
SELF_CRITIQUE=           # Set to 0 to disable pre-generation context sufficiency check and fallback search (default: on)
```

The `VITE_PRISMIC_ENVIRONMENT` env var can optionally override the Prismic repository name used (useful for staging environments).

---

## Chat & RAG Pipeline

### How the chat pipeline works (`/api/chat`)

1. Client sends `POST /api/chat` with the full message history
2. Server uses `getContext()` (`src/lib/utilities/context.ts`) to retrieve relevant docs:
   - **Query rewrite + HyDE expansion** (`src/lib/rewrite.ts`): standalone search query via AI SDK `generateText`, then HyDE (Hypothetical Document Embeddings) generates a brief hypothetical answer and concatenates it with the query to improve vector similarity for vague questions
   - Embeds with `text-embedding-3-small` (512 dims) and queries Qdrant (`k=16` per branch: main site + optional iMessage + optional entity-filtered search), deduped and ordered by vector score
   - **LLM reranking** (`src/lib/server/rerank.ts`): over-retrieved 16 candidates are scored by GPT-4.1-mini for relevance and reduced to top 5. Disable with `RERANK_ENABLED=0`.
   - **Source diversity filter**: max 2 chunks per unique source URL to avoid redundant context
   - **Entity-aware search**: queries mentioning a person name trigger an additional Qdrant search filtered on `metadata.contact` / `metadata.participants`
   - CONTEXT chunks are labeled with `[CHUNK-...]` ids for grounding
   - **Qdrant vector naming**: Retrieval uses `src/lib/server/qdrant-search.ts`, which matches LangChain’s embed shape. It reads the collection config and uses a **named** vector (`{ name, vector }`) when the collection defines named dense vectors (common for Qdrant Cloud / dashboard-created collections). Set `QDRANT_VECTOR_NAME` if auto-detection picks the wrong vector on multi-vector collections.
3. **RAG router** (`src/lib/server/rag-router.ts`, schema `src/lib/schemas/ragRouter.ts`): optional structured plan via `generateObject` + `gpt-4o-mini` — up to **3 supplemental vector searches** (`searchKnowledgeBase` under the hood) when initial CONTEXT is thin or off-topic. Results are appended as `PRE-RUN VECTOR SEARCHES` in the same CONTEXT block. Optional `assistant_hint` is injected above CONTEXT. Set `RAG_ROUTER=0` to disable.
4. **Context sufficiency check**: if CONTEXT has zero or one chunk, a fallback `searchKnowledgeBase` call appends broader results. Disable with `SELF_CRITIQUE=0`.
5. Retrieved context (including any pre-run and fallback searches) is injected into the system prompt alongside the full message history
6. OpenAI `gpt-4.1-mini` is called with streaming + tools (Vercel AI SDK `streamText`, `temperature: 0`)
7. Vercel AI SDK streams the response back to the client via `toUIMessageStreamResponse()`
8. LangSmith traces the full pipeline run (retrieval + LLM call) for observability

### Function calling

The LLM can invoke two functions:

| Function | Effect |
|---|---|
| `minimize_chat` | Minimizes the chat widget |
| `route_to_page` | Navigates the browser to a site page via SvelteKit's `goto()` |

All valid route destinations are defined in `src/lib/types.ts` as the `SupportedRoutes` enum. **When adding new pages to the site, add the route to `SupportedRoutes` so HuntBot can navigate to it.**

### Client-side chat state (`MessageStore.ts`)

- Uses Vercel AI SDK's `useChat()` (`ai/svelte`)
- Chat ID is hardcoded as `'uniquechatid'` — this keeps a single persistent conversation across navigations
- `botEngaged` and `minimized` are Svelte writable stores that control chat visibility
- Function call results are appended to the message list as `role: 'function'` messages

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

---

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

### Do not
- Use `process.env` — use `$env/dynamic/private` instead
- Edit `src/prismicio-types.d.ts` manually
- Add hardcoded route strings without updating `SupportedRoutes` in `types.ts`
- Commit `.env` files

---

## Deployment

The project deploys automatically to **Vercel** on push to `main`. The adapter is `@sveltejs/adapter-vercel`. No special build configuration is required beyond setting environment variables in the Vercel dashboard.
