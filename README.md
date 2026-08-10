# HuntBot

My exploration building a portfolio that uses a personal LLM, _HuntBot_, to navigate users around the site and help sell Hunter as a high quality job candidate.

HuntBot has been built using the following technologies:

- Typescript because types are good
- Svelte/SvelteKit as the meta-framework, just because I've heard good things and it's a nice developer experience.
- Prismic as my CMS. I experimented with Sanity and Payload, but I liked Prismic for:
  - Local GUI front end for configuring data models
  - Slicemachine for simulating pages before publishing
  - Generated types for data models
  - Decent documentation for use with SvelteKit
- Langchain JS is used, but only for handling my Retrieval Augmented Generation (RAG) pipeline — connecting to Qdrant and loading documents to embed from various sources (I load documents from Notion, obscure .txts, .csvs, random URLs, and even my own iMessage history).
- Qdrant Cloud as my Vector DB to hold embeddings. I originally used Pinecone's free serverless tier, but migrated to Qdrant Cloud's free tier — same idea (small enough to live on a free plan), different provider. Worth noting: the free tier auto-suspends a cluster after a week of inactivity and deletes it after four, so there's a daily Vercel Cron job (`/api/cron/qdrant-keepalive`) that pings it to make sure that never happens again (it happened once).
- Vercel AI SDK is the backbone for getting streaming chat responses from the server, and handling OpenAI function calls via its function handler (both on server & on client).

## Setup

The main chat model is `gpt-5.6-terra` (OpenAI's current balanced/mid-tier model), called through the Vercel AI SDK's `streamText`. Reranking retrieved chunks uses the cheaper `gpt-5.6-luna`. Both are reasoning models, which means they reject a `temperature` param — none is set anywhere in the pipeline; persona consistency comes entirely from the system prompt instead.

The project expects several environmental variables to connect with various APIs and hold various secrets:

```bash
export OPENAI_API_KEY="..."
export OPENAI_ASISTANT_ID="..."
export LANGCHAIN_API_KEY="..."      # LangSmith tracing for the RAG pipeline
export JWT_KEY="..."
export AUTH_PASSWORD="..."
export ADMIN_PASSWORD="..."
export QDRANT_URL="..."             # e.g. https://xxx.cloud.qdrant.io:6333
export QDRANT_API_KEY="..."
export QDRANT_COLLECTION="..."
export NOTION_INTEGRATION_TOKEN="..."
export CRON_SECRET="..."            # authorizes the daily Qdrant keepalive cron
# export QDRANT_VECTOR_NAME="default"  # If Qdrant errors with "Not existing vector name" (named-vector collection)
# Optional RAG tuning (see CLAUDE.md)
# export RAG_DEBUG=1             # Verbose RAG logs outside dev
# export RAG_REFLECTION=1        # PostHog structured audit of replies vs context
# export RAG_ROUTER=0            # Disable pre-turn supplemental vector search planner
# export RERANK_ENABLED=0        # Disable LLM reranking of retrieved chunks
# export SELF_CRITIQUE=0         # Disable pre-generation context sufficiency check
```

The auth password is what site visitors must use to gain access to protected case studies. The admin password is used for access to the admin tools — that's where the triggers live for embedding new data into the vector DB (site crawl, Notion, local files, and iMessage).

At the time of writing, HuntBot's chat endpoint gives the LLM five tools to call:

```bash
#Minimize chat
#Will minimize the chat

{
	"name":  "minimize_chat",
	"description":  "Minimize the chat interface in which this thread is taking place.",
	"parameters":  {
		"type":  "object",
		"properties":  {},
		"required": []
	}
}
```

```bash
#Route to page
#Will route the site visitor to the relevant page based on the conversation

{
	"name":  "route_to_page",
	"description":  "Navigate the user to a page on Hunter's site. Only call this with an exact URL copied verbatim from the approved list in the system prompt.",
	"parameters":  {
		"type":  "object",
		"properties":  {
			"page":  {
				"type":  "string",
				"enum": [
				"/case-studies/gathers",
				"/case-studies/karoo2",
				...
				]
			}
		},
		"required": [
			"page"
		]
	}
}
```

Three more tools round things out: `ask_clarifying_question` (asks one focused follow-up when a query is too vague to answer well), `capture_lead_intent` (fires when a visitor signals they want to hire or collaborate with Hunter, and surfaces contact options), and `search_knowledge_base` (lets the model run an extra targeted vector search mid-conversation if the pre-run context wasn't enough).

Currently, the enum values that `route_to_page` can return come from a live Prismic API call (`getAvailableRoutes()` in `src/lib/server/site-nav-routes.ts`), so new case studies and projects show up automatically without a code change. Static routes are still hardcoded in the `SupportedRoutes` enum — you can find it and the rest of the shared types [here](src/lib/types.ts).

## RAG Pipeline

At the time of this commit, the pipeline used for the LLM is as follows:

- User submits a message in the client
- The `/api/chat` endpoint receives the message
  1. Rewrite the user's message into a standalone search query using the recent chat history as context, then run HyDE (Hypothetical Document Embeddings) — generate a brief hypothetical answer and concatenate it with the query — to improve vector similarity for vague questions like `"what classes did he take?"` instead of `"what engineering classes did Hunter take while at USC?"`
  2. Embed the rewritten query and search Qdrant across parallel branches (main site content, iMessage if enabled, and an entity-filtered branch when the message mentions a specific person), over-retrieving 16 chunks per branch
  3. LLM-rerank the over-retrieved candidates down to the top 5 using `gpt-5.6-luna`, then apply a source-diversity filter (max 2 chunks per source) so one document can't dominate the context
  4. A structured "RAG router" call (`gpt-5.6-terra`) decides whether the initial context is thin or off-topic and, if so, plans up to 3 more targeted vector searches before generation even starts
  5. If context still comes back empty or nearly empty after all that, a broader fallback search runs as a last resort
  6. Submit the full chat history plus all retrieved context to `gpt-5.6-terra` with tool definitions via the Vercel AI SDK's `streamText`
  7. Stream the response back to the client, and handle any function calls returned from the LLM via the AI SDK's tool-call handling

Any step in this pipeline is subject to change. Things on my list:

- Indexing — help manage the entries in my vector db and delete duplicates
- Generally clean up dataset — most embeddings were from raw data I tossed over the fence. Since it's from different sources, it would be nice to add more metadata where appropriate, to enable more focused context and self-querying retrieval, where the LLM writes its own metadata filter.
- Better observability into which retrieval branch (site / Notion / iMessage) actually ends up grounding a given answer, beyond what LangSmith traces already show.

See `CLAUDE.md` for the full technical reference — directory structure, all env vars, embedding sources, and conventions for extending the codebase.
