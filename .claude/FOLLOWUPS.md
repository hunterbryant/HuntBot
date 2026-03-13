# Phase 2 — Deferred Improvements

These require re-embedding or infrastructure changes and are out of scope for Phase 1.

## Retrieval quality

- **Hybrid search (BM25 + dense vectors)** — Add a sparse index to Qdrant and blend keyword and semantic scores. Better recall for exact names, project titles, and proper nouns. Requires re-embedding with sparse vectors.
- **Reranking (Cohere Rerank API)** — After hybrid search is working, pass the top-20 candidates through a cross-encoder reranker before injecting into context. Measurably improves precision at low cost.
- **Semantic chunking** — Replace fixed 1000-char splits with topic-boundary splits (e.g. LangChain `SemanticChunker`). Chunks better reflect actual content units.
- **Parent-child chunking** — Embed small child chunks for high-precision retrieval; return the larger parent chunk as the actual context. Better than increasing chunk size directly.

## Knowledge base

- **Metadata enrichment with dates** — Tag each chunk with a `date` field at embed time. Inject "most recent date seen: [date]" into the system prompt so the model stops presenting old info as current.
- **Incremental re-embedding** — Build a hash-based diffing step so only changed pages are re-embedded on each crawl run, reducing cost and latency.

## UX / function calling

- **Guided portfolio tour** — A `start_tour` function call that queues a sequence of `route_to_page` calls with narration between them, letting HuntBot walk a visitor through selected work end-to-end.
- **Rolling conversation summary** — Periodically summarize the conversation history into a compressed system message to extend effective context length for long sessions. Low priority given typical session length.

## Observability

- **Per-session retrieval quality scoring** — Log retrieval precision (how many returned chunks were actually used in the final response) back to LangSmith for ongoing monitoring.
