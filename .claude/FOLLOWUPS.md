# Phase 2 — Deferred Improvements

These require re-embedding or infrastructure changes and are out of scope for Phase 1.

## Retrieval quality

- ~~**Hybrid search (BM25 + dense vectors)**~~ — ✅ Shipped (Phase 2). Sparse index + RRF fusion in Qdrant.
- ~~**Reranking (Cohere Rerank API)**~~ — Skipped. HyDE + hybrid search + parent-child chunking already provides strong retrieval for ~1000 chunks. Reranker adds 200-500ms latency for marginal gain at this scale. Revisit if corpus grows significantly.
- ~~**Semantic chunking**~~ — ✅ Shipped (Phase 3). `RecursiveCharacterTextSplitter.fromLanguage('markdown')` for Notion, plain recursive for other sources.
- ~~**Parent-child chunking**~~ — ✅ Shipped (Phase 3). Child chunks (300 chars) for retrieval, parent (1500 chars) returned as context via `metadata.parentContent`.

## Knowledge base

- **Metadata enrichment with dates** — Tag each chunk with a `date` field at embed time. Inject "most recent date seen: [date]" into the system prompt so the model stops presenting old info as current.
- **Incremental re-embedding** — Build a hash-based diffing step so only changed pages are re-embedded on each crawl run, reducing cost and latency.

## UX / function calling

- **Guided portfolio tour** — A `start_tour` function call that queues a sequence of `route_to_page` calls with narration between them, letting HuntBot walk a visitor through selected work end-to-end.
- **Rolling conversation summary** — Periodically summarize the conversation history into a compressed system message to extend effective context length for long sessions. Low priority given typical session length.

## Observability

- **Per-session retrieval quality scoring** — Log retrieval precision (how many returned chunks were actually used in the final response) as a PostHog event for ongoing monitoring. Note: we don't use LangSmith — PostHog is the analytics layer.
