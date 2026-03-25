import { env } from '$env/dynamic/private';
import { ragRouterSchema, type RagRouterPlan } from '$lib/schemas/ragRouter';
import { logRag } from '$lib/server/rag-debug';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, zodSchema } from 'ai';

const CONTEXT_PREVIEW_MAX = 14_000;

/**
 * Structured plan for supplemental Qdrant searches before `streamText`.
 * Set `RAG_ROUTER=0` to skip (saves one small LLM call per message).
 */
export async function planSupplementalSearches(options: {
	userMessage: string;
	priorUserMessages: string[];
	contextText: string;
}): Promise<RagRouterPlan> {
	if (env.RAG_ROUTER === '0') {
		return { supplemental_searches: [] };
	}

	const { userMessage, priorUserMessages, contextText } = options;
	const trimmed = userMessage.trim();
	// Skip router for trivial acknowledgements
	if (trimmed.length < 3) {
		return { supplemental_searches: [] };
	}

	const prior =
		priorUserMessages.length > 0
			? `Earlier user messages (oldest first):\n${priorUserMessages.map((m) => `- ${m}`).join('\n')}\n`
			: '';

	const contextPreview =
		contextText.trim().length === 0
			? '(No CONTEXT was retrieved — the vector store may be empty or retrieval failed. Propose searches if the question needs knowledge base data.)'
			: contextText.slice(0, CONTEXT_PREVIEW_MAX);

	try {
		const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
		const { object } = await generateObject({
			model: openai('gpt-4o-mini'),
			schema: zodSchema(ragRouterSchema),
			temperature: 0.1,
			prompt: `You route retrieval for HuntBot (Hunter Bryant's portfolio + Notion notes + optional iMessage chunks).

Decide if the INITIAL CONTEXT below is sufficient for a grounded answer to the LATEST user message, or if 1–3 extra vector searches will materially help.

Rules:
- Return ZERO supplemental_searches if CONTEXT clearly covers the question (any section: SITE, NOTES, IMESSAGE).
- Add searches when CONTEXT is empty, thin, off-topic, or missing the specific entity/topic the user asked about.
- Use source_filter "imessage" for personal life, relationships, casual plans, "what Hunter said", texts.
- Use "site" for design work, employers, projects, case studies, essays on the portfolio.
- Use "all" when the question could span sources or you're unsure.
- Queries should be standalone (include names/topics from the user message); do not assume the search model sees chat history.
- Do NOT add searches that merely duplicate information already present in CONTEXT.

${prior}
Latest user message:
${userMessage}

---

INITIAL CONTEXT (excerpt; chunks use [CHUNK-...] ids):
${contextPreview}`
		});

		logRag('rag router plan', {
			searchCount: object.supplemental_searches.length,
			queries: object.supplemental_searches.map((s) => s.query.slice(0, 80)),
			filters: object.supplemental_searches.map((s) => s.source_filter),
			hint: object.assistant_hint?.slice(0, 120)
		});

		return object;
	} catch (err) {
		console.warn('RAG router failed, continuing without supplemental searches:', err);
		return { supplemental_searches: [] };
	}
}
