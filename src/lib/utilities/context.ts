import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import type { Document } from '@langchain/core/documents';
import { compile } from 'html-to-text';
import { getImessageEnabled } from '$lib/server/imessage-config';

export type Metadata = {
	url: string;
	text: string;
	chunk: string;
};

const convertHtml = compile({ wordwrap: 130 });
const SITE_ORIGIN = 'https://www.hunterbryant.io';

// Pages that are listing/nav pages — not specific enough to force-fetch
const BROWSE_PAGES = new Set(['/', '/case-studies', '/projects', '/information']);

// Score threshold for filtering noise
const MIN_SCORE = 0.3;

// For matched site pages, fetch the full page text at query time rather than
// relying on whatever chunk happened to score highest. This ensures the LLM
// sees the complete case study / project page, not just a 1000-char fragment.
// Falls back to null on timeout or error so retrieval degrades gracefully to chunks.
async function fetchFullPageText(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		const html = await res.text();
		// Cap at 10k chars — enough for a full case study without blowing the context window
		return convertHtml(html).slice(0, 10000);
	} catch {
		return null;
	}
}

// Deduplicate chunks by source + content fingerprint before processing
function deduplicateDocs(docs: Document[]): Document[] {
	const seen = new Set<string>();
	return docs.filter((doc) => {
		const key = (doc.metadata?.source ?? '') + doc.pageContent.slice(0, 80);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// Rewrite a follow-up message into a standalone search query using an LLM.
// For first messages (no history), returns the raw message + page slug with no LLM call.
// For follow-ups, the LLM incorporates conversation context so "tell me more about that"
// becomes "tell me more about Hunter's work on the Uber autonomous booking experience."
async function rewriteQuery(
	model: ChatOpenAI,
	message: string,
	conversationHistory: string[],
	currentPage: string
): Promise<string> {
	// Single-turn: no rewrite needed, just append page slug for context
	if (conversationHistory.length === 0) {
		if (currentPage && !BROWSE_PAGES.has(currentPage)) {
			const slug = currentPage.split('/').pop();
			return slug ? `${message} ${slug}` : message;
		}
		return message;
	}

	// Multi-turn: LLM rewrites follow-up into standalone query
	try {
		const recent = conversationHistory.slice(-3);
		const pageHint = !BROWSE_PAGES.has(currentPage)
			? `The user is currently viewing: ${currentPage}`
			: '';

		const response = await model.invoke(
			`Rewrite the follow-up message into a standalone search query that captures the full intent. Include any names, topics, or specifics from the conversation that the follow-up refers to. Output ONLY the rewritten query, nothing else.

${pageHint}

Conversation history:
${recent.map((m, i) => `User ${i + 1}: ${m}`).join('\n')}

Follow-up: "${message}"`
		);
		return (response.content as string).trim() || message;
	} catch {
		return message;
	}
}

// Retrieve context for a user message using a single-round vector search.
// The LLM can call search_knowledge_base for additional retrieval when needed.
export const getContext = async (
	message: string,
	conversationHistory: string[] = [],
	currentPage: string = '/'
): Promise<string> => {
	const vectorStore = await QdrantVectorStore.fromExistingCollection(
		new OpenAIEmbeddings({
			modelName: 'text-embedding-3-small',
			openAIApiKey: env.OPENAI_API_KEY,
			dimensions: 512
		}),
		{
			url: env.QDRANT_URL,
			apiKey: env.QDRANT_API_KEY,
			collectionName: env.QDRANT_COLLECTION
		}
	);

	const model = new ChatOpenAI({
		openAIApiKey: env.OPENAI_API_KEY
	});

	const retrievalQuery = await rewriteQuery(model, message, conversationHistory, currentPage);
	const imessageEnabled = await getImessageEnabled();

	const mainFilter = {
		must_not: [{ key: 'metadata.source', match: { value: 'imessage' } }]
	};
	const imessageFilter = {
		must: [{ key: 'metadata.source', match: { value: 'imessage' } }]
	};

	// ── Round 1: Direct search ──
	const [mainResults, imessageResults] = await Promise.all([
		vectorStore.similaritySearchWithScore(retrievalQuery, 8, mainFilter),
		imessageEnabled
			? vectorStore.similaritySearchWithScore(retrievalQuery, 8, imessageFilter)
			: Promise.resolve([] as [Document, number][])
	]);

	const allScoredResults: [Document, number][] = [...mainResults, ...imessageResults];

	// Filter by MIN_SCORE, then dedup
	let docs = allScoredResults
		.filter(([, score]) => score >= MIN_SCORE)
		.map(([doc]) => doc);

	// If score filtering removes everything, keep the single best result
	// so the LLM has something to work with rather than zero context.
	if (docs.length === 0 && allScoredResults.length > 0) {
		// Sort descending by score to pick the best one
		allScoredResults.sort((a, b) => b[1] - a[1]);
		docs = [allScoredResults[0][0]];
	}

	const deduplicated = deduplicateDocs(docs);

	// Split retrieved docs into site pages, iMessage, and other sources.
	// Keep up to MAX_IMESSAGE_CHUNKS_PER_CHAT highest-scoring chunks per conversation —
	// chunks arrive ranked by score so the first stored is the best match. Allowing a
	// second chunk lets topically distinct sections (e.g. work talk vs. side projects)
	// from the same long conversation both surface in context.
	const MAX_IMESSAGE_CHUNKS_PER_CHAT = 2;
	const siteUrls = new Set<string>();
	const imessageChatChunks = new Map<string, Document[]>();
	const fallbackDocs: Document[] = [];

	for (const doc of deduplicated) {
		const source = doc.metadata?.source;
		if (source === 'imessage') {
			const chatId = String(doc.metadata?.chatId ?? '');
			if (chatId) {
				const existing = imessageChatChunks.get(chatId) ?? [];
				if (existing.length < MAX_IMESSAGE_CHUNKS_PER_CHAT) {
					existing.push(doc);
					imessageChatChunks.set(chatId, existing);
				}
			}
		} else if (typeof source === 'string' && source.startsWith(SITE_ORIGIN)) {
			siteUrls.add(source);
		} else {
			fallbackDocs.push(doc);
		}
	}

	// Build iMessage context. First chunk: use expandedContext (±5k char window around
	// the best match). Additional chunks: include their raw pageContent only if not
	// already covered by the primary window, to avoid redundancy without losing coverage.
	const imessageParts: string[] = [];
	for (const [, chunks] of imessageChatChunks) {
		const meta = chunks[0].metadata ?? {};
		// Use participants list for group chats so all names appear in the context label
		const label =
			meta.isGroupChat === 1 && meta.participants ? meta.participants : (meta.contact ?? 'unknown');
		const primaryContext = meta.expandedContext || chunks[0].pageContent;
		const parts = [primaryContext];

		for (let i = 1; i < chunks.length; i++) {
			const extra = chunks[i].pageContent;
			// Skip if the primary window already contains this chunk's opening text
			if (!primaryContext.includes(extra.slice(0, 80))) {
				parts.push(extra);
			}
		}

		const dateInfo = meta.dateRange ? ` (${meta.dateRange})` : '';
		const msgCount = meta.messageCount ? ` — ${meta.messageCount} messages` : '';
		const participantLine =
			meta.isGroupChat === 1 && meta.participants ? `Participants: ${meta.participants}\n` : '';
		imessageParts.push(
			`[iMessage — ${label}${dateInfo}${msgCount}]\n${participantLine}${parts.join('\n\n---\n\n')}`
		);
	}

	if (currentPage && !BROWSE_PAGES.has(currentPage)) {
		siteUrls.add(`${SITE_ORIGIN}${currentPage}`);
	}

	const pageResults = await Promise.all(
		[...siteUrls].map(async (url) => {
			const text = await fetchFullPageText(url);
			return text ? `[${url}]\n${text}` : null;
		})
	);

	const fallbackParts = fallbackDocs.map((doc) => {
		const label = doc.metadata?.title || doc.metadata?.source || '';
		return label ? `[${label}]\n${doc.pageContent}` : doc.pageContent;
	});

	const sections: string[] = [];

	const siteContent = pageResults.filter((r): r is string => r !== null);
	if (siteContent.length > 0) {
		sections.push(`### SITE CONTENT (pages from hunterbryant.io)\n${siteContent.join('\n\n---\n\n')}`);
	}

	if (fallbackParts.length > 0) {
		sections.push(`### NOTES & DOCUMENTS\n${fallbackParts.join('\n\n---\n\n')}`);
	}

	if (imessageParts.length > 0) {
		sections.push(`### IMESSAGE CONVERSATIONS (private text messages — separate source from above)\n${imessageParts.join('\n\n---\n\n')}`);
	}

	return sections.join('\n\n========\n\n');
};

// Search the knowledge base on demand (called by the search_knowledge_base tool).
// Returns formatted chunks with scores for the LLM to synthesize.
export async function searchKnowledgeBase(
	query: string,
	sourceFilter: 'all' | 'imessage' | 'site' = 'all'
): Promise<string> {
	const vectorStore = await QdrantVectorStore.fromExistingCollection(
		new OpenAIEmbeddings({
			modelName: 'text-embedding-3-small',
			openAIApiKey: env.OPENAI_API_KEY,
			dimensions: 512
		}),
		{
			url: env.QDRANT_URL,
			apiKey: env.QDRANT_API_KEY,
			collectionName: env.QDRANT_COLLECTION
		}
	);

	let filter: Record<string, unknown> | undefined;
	if (sourceFilter === 'imessage') {
		filter = { must: [{ key: 'metadata.source', match: { value: 'imessage' } }] };
	} else if (sourceFilter === 'site') {
		filter = { must_not: [{ key: 'metadata.source', match: { value: 'imessage' } }] };
	}

	const results = await vectorStore.similaritySearchWithScore(query, 8, filter);
	const filtered = results.filter(([, score]) => score >= MIN_SCORE);

	if (filtered.length === 0) {
		return 'No relevant results found for this query.';
	}

	return filtered
		.map(([doc, score]) => {
			const source = doc.metadata?.source ?? 'unknown';
			const label = doc.metadata?.title || doc.metadata?.contact || source;
			return `[${label} (score: ${score.toFixed(2)})]\n${doc.pageContent}`;
		})
		.join('\n\n---\n\n');
}
