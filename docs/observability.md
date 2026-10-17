# Observability

What HuntBot logs to Vercel and sends to PostHog, and the rules for adding more. Read this before adding a log line or an analytics event.


Everything worth reflecting on later lands in two places: **Vercel runtime logs** (one structured JSON line per thing, greppable by prefix) and **PostHog** events (joined on `run_id` per chat turn, `session_id` per conversation). Message text goes to PostHog only, never into the always-on log lines, and the chunk audit never sends chunk text anywhere, only ids.

**Server-side PostHog events must go through `captureServerEvent` in `src/lib/server/posthog.ts`.** It registers the request with Vercel's `waitUntil`, so events sent after the response (and the post-reply audits that produce them, via `runInBackground`) aren't lost when the function is frozen, and it logs a `[HuntBot analytics]` line when a send fails instead of swallowing it. The post-reply grounding and reflection calls only run when `PUBLIC_POSTHOG_API_KEY` is set (`isAnalyticsEnabled()`), since their results only go to PostHog. Grounding sees the start and the end of CONTEXT when it's over 12k chars, so router and fallback search results (appended last) aren't cut.

## Vercel log lines

| Prefix | When | What's in it |
|---|---|---|
| `[HuntBot timing]` | Every chat turn | Lane, model, lane scores, ms per stage (including `analysis_fetch` / `analysis_sandbox` on turns that ran training analysis), `rerank_engine`, `rerank_failed`, `answers_question`, `router_gate`, `router_ran`, `retrieval_failed`, `model_failure`, `excluded_by_audit` |
| `[HuntBot grounding]` | Every audited reply | `run_id`, grounding / voice scores, miss and first-person probabilities, `visitor_intent`, `decision_ms`, `input_tokens`; or `error` + `refused` |
| `[HuntBot chunk audit]` | Each ~45s audit run, plus `started` / `finished` / `failed` | Counts overall and `bySource` (site / notes / imessage), `inputTokens`, `durationMs`, and `flagged` (id, source, reason, scores, up to 100 per run) for spot-checking in Qdrant |
| `[HuntBot training]` | Every `get_training_totals` / `analyze_training_data` call, plus warnings for failed intervals.icu requests and a one-time "training tools are off" notice when the `INTERVALS_*` env vars are missing | `run_id`, `tool`, `outcome` (`ok` / `bad_dates` / `data_unavailable` / `sandbox_unavailable` / `deadline` / `run_failed` / `script_error`), date range, `include_location`, `total_ms`, `fetch_ms`, `sandbox_create_ms` / `sandbox_run_ms`, `requests` / `cache_hits` / `fetch_failures`, row counts, `hidden_strava`, `exit_code`, `stdout_bytes`, `stderr_head` (start of a Python traceback), `sandbox_error` + `sandbox_phase`, `network_fallback` (the policy was refused and the run went ahead offline; logged as a warning). Numbers and error text only: never the script's output or any training or wellness data |
| `[HuntBot tools]` | Every `query_notion` (with its `action`), `match_job_description` and `explain_huntbot` call, and every open-role lookup (`company_roles`, from the network hint or the `find_open_roles` tool); a one-time notice when `NOTION_INTEGRATION_TOKEN` is unset, and warnings for failed Notion requests, job-posting extraction and the roles web fallback (error text has key-shaped strings redacted by `describeError`, since provider errors can echo part of an API key) | `run_id`, `tool`, `action` (Notion), `outcome` (`ok`, `empty`, `failed`, `not_configured`, `bad_request`, `no_posting`, `not_a_posting`, `extract_failed`, `search_failed`), `ms`, `results`, `source` (`ats` / `web` / `cache` / `none`, for roles), `requirements` / `gaps` / `input` (`text` or `url`, for job matching). Counts and labels only: never page text, posting text or anything the visitor typed |
| `[HuntBot sandbox]` | Once per warm instance | Code execution is off because the function isn't on Vercel and `VERCEL_OIDC_TOKEN` is unset |
| `[HuntBot analytics]` | A PostHog send failed | `event`, HTTP `status` or `error` |
| `[AUTH] Denied admin API` | A request to `/api/embed/*` or `/api/admin/*` without admin auth | `method`, `path`, `role` |
| `[HuntBot RAG]` | Only in dev or with `RAG_DEBUG=1` | Step-by-step retrieval / rerank / tool detail |

## PostHog events

| Event | Sent by | Key properties |
|---|---|---|
| `chat_message` | Chat endpoint, once per turn | See step 10 of [chat-pipeline.md](chat-pipeline.md), plus `visitor_arrived_via`, `visitor_via`, `visitor_device`, `visitor_timezone`, `visitor_language`, `visitor_country`, `visitor_org`, `visitor_org_class`, `visitor_pages_seen`, `visitor_returning`, `visitor_org_mentioned` (all dropped under GPC, which records only `gpc: true`), `rerank_engine`, `rerank_failed`, `rerank_input_tokens`, `router_gate` (`deep_lane` / `decisions` / `heuristic`), `context_answers_question`, `context_excluded_by_audit` (chunks that would have made the top-k), `notion_calls` / `notion_actions` / `notion_results` (turns that used `query_notion`), `context_cache_hit` (repeat first-turn question served from cache; its rerank tokens are not counted again), `retrieval_error`, and, on turns that used the training tools, `training_calls`, `training_outcomes`, `analysis_runs` (runs that tried to start a sandbox), `analysis_failures` (runs that didn't start or exited non-zero), `analysis_deadline_hit`, `training_hidden_strava`, `training_fetch_failures`, `training_cache_hits`, `sandbox_error`, `analysis_stderr`, and, on turns that used the knowledge tools, `tool_outcomes`, `notion_results`, `self_docs_sections`, `roles_source`, `roles_count`, `jd_requirements`, `jd_gaps`, `jd_input`, `model_failure` (`unavailable` = out of credits / bad key / no access, `transient` = rate limit or provider error, null = fine) |
| `rag_grounding` | Post-reply Decisions audit | `grounding_score`, `makes_claims_probability`, `speaks_as_hunter_probability`, `admits_miss_probability`, `voice_score`, `visitor_intent` (+ probabilities), `decision_ms`, `decision_input_tokens`, `grounding_error`, `grounding_refused`, `is_admin` |
| `rag_reflection` | Optional (`RAG_REFLECTION=1`) | `rag_thinking`, `rag_citations`, `rag_confidence` |
| `chunk_audit_run` | Each audit run | Counts, `by_source`, `input_tokens`, `duration_ms`, `more` |
| `chunk_audit_finished` / `chunk_audit_failed` | End of an audit job | Job totals, `duration_ms`, `input_tokens`; `error` on failure |
| Client events | `src/lib/analytics.ts` | `$pageview`, `role_opener_shown` (the proactive open-role question); tapped answers to any `ask_visitor` / opener question are `suggestion_clicked` with `suggestion_type: option`; `chat_message` gets `simulated_org: true` on turns using `/simulate`, `suggestions_shown`, `suggestion_clicked`, `related_page_clicked`, `contact_clicked`, `not_helpful` |

Chunk audit events use `distinct_id: huntbot-system` with `$process_person_profile: false`, so they don't create a fake person. Filter `is_admin = true` out of chat analytics to drop Hunter's own testing.
