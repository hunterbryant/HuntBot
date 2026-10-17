# Knowledge base

How the Qdrant collection is filled, audited and kept alive. Read this before touching `src/routes/api/embed/`, `src/lib/server/chunk-audit.ts` or the Qdrant keepalive cron.


The Qdrant vector collection is the knowledge base for HuntBot. It is populated by hitting admin endpoints (protected, requires admin auth).

## Embedding sources

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

## Chunk audit (quality + privacy tags, no re-embedding)

`src/lib/server/chunk-audit.ts` tags every chunk with `metadata.audit` using OpenAI Decisions (8 chunks per call): a `substance` score (0–3, boilerplate → rich), and for notes/iMessage chunks a `sensitive` probability (contact details, financial/medical/legal details, credentials, private details about other people). The tags are written in place with Qdrant `set_payload`, so vectors are never touched and nothing needs re-embedding. It's started by hand and runs in the background: the **Audit** button under Quality on `/admin/embeddings` calls `POST /api/admin/chunk-audit` (admin cookie required), which returns immediately and tags whatever isn't tagged at the current `CHUNK_AUDIT_VERSION` after the response (`waitUntil` from `@vercel/functions`, up to 240s per run, `maxDuration: 300`). If untagged chunks remain, each run calls the endpoint again to start the next one, authorized with `CRON_SECRET` since the admin's login cookie expires after an hour (plus `VERCEL_AUTOMATION_BYPASS_SECRET`, sent on a retry, to get through Deployment Protection on previews). On production that call goes to `https://huntbot.vercel.app`, not hunterbryant.io: the custom domain is proxied through Cloudflare, whose bot challenge answers server-to-server requests with a 403 "Just a moment…" page. Set `CHUNK_AUDIT_ORIGIN` to override the target if the project's vercel.app alias ever changes. A refused call's error shows Vercel's `x-vercel-error` / `x-vercel-mitigated` / `server` headers and the start of the body. Progress is saved after every run in a `_config` point in Qdrant, like the iMessage toggle, so the admin page shows running / finished / failed with counts whenever it's opened. Vercel stops a chain of self-calls after about six hops (508 `INFINITE_LOOP_DETECTED`); that's why each run is long, and when it happens the job is marked **paused**, not failed. The admin page resumes a paused job on its own while it's open (a browser request starts a fresh chain), or **Resume** continues it later, keeping its start time and totals. A `running` status that hasn't updated in 6 minutes shows as stopped and also gets **Resume**. Each run stops starting new batches at 240s and aborts any call still in flight at 248s, so it always has time to save progress and start the next run before the 300s function limit; chunks it didn't reach stay untagged for the next run. Start failures (including an expired admin login) show in red under the button. Run it after indexing so new chunks get checked too; until then they're simply kept. The admin page also shows a **cost estimate** (`estimateAuditCost`): the collection's chunk count and how many are still untagged, priced at the current job's measured input tokens per chunk (or ~1,076, measured on the first production run, until the job has its own figure) times `CHUNK_AUDIT_USD_PER_M_INPUT`. Output tokens are left out; Decisions answers are a few tokens per question. Bump `CHUNK_AUDIT_VERSION` after changing the rubric to re-audit everything.

Retrieval (`searchByEmbedding` in `context.ts`) drops chunks flagged `low_value` (substance < 0.75) or `sensitive` (probability ≥ 0.8) right after each Qdrant search. That's done in code rather than as a Qdrant filter, so retrieval never depends on an audit index existing, and untagged chunks are always kept. Each search fetches 8 extra results so excluded chunks don't shrink the top-k. Refused chunks are tagged `refused: true` and kept. A run logs one `[HuntBot chunk audit]` line with counts.

## Keeping the free Qdrant cluster alive

Qdrant Cloud's free tier auto-suspends a cluster after 1 week of inactivity and deletes it after 4 weeks if it's not reactivated — this has already happened once to this project. Qdrant doesn't publicly document what counts as "activity," so relying on organic site traffic (visitors triggering chat → vector search) isn't reliable, since a low-traffic personal portfolio site can go days without a single chat query.

`vercel.json` schedules a daily Vercel Cron job (`GET /api/cron/qdrant-keepalive`) that runs a real `scroll` read against the collection — genuine data-plane traffic, not just a metadata/health-check call — well within the 1-week suspension window with margin to spare. The endpoint is secured with `CRON_SECRET` per [Vercel's cron job pattern](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs): set a random 16+ char value for `CRON_SECRET` in the Vercel dashboard and Vercel automatically sends it as the request's `Authorization: Bearer` header. Vercel's Hobby plan caps cron frequency at once/day; that's already ~7x margin under the suspension threshold.

---
