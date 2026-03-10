import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import type { Document } from '@langchain/core/documents';
import { compile } from 'html-to-text';
import { MultiQueryRetriever } from 'langchain/retrievers/multi_query';
import { Client } from 'langsmith';
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

// Build an enriched retrieval query that incorporates recent conversation history
// and the current page slug. This helps MultiQueryRetriever handle follow-up
// questions like "tell me more about this page" by grounding the query.
function buildRetrievalQuery(
	message: string,
	conversationHistory: string[],
	currentPage: string
): string {
	const parts: string[] = [];
	if (conversationHistory.length) {
		parts.push(conversationHistory.slice(-3).join(' | '));
	}
	parts.push(message);
	// Include the page slug so retrieval finds the right content for vague follow-ups
	if (currentPage && !BROWSE_PAGES.has(currentPage)) {
		const slug = currentPage.split('/').pop();
		if (slug) parts.push(slug);
	}
	return parts.join(' | ');
}

// The function `getContext` is used to retrieve the context of a given message
export const getContext = async (
	message: string,
	runID: string,
	pipeline: any,
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

	const langsmithClient = new Client({
		apiKey: env.LANGCHAIN_API_KEY
	});

	const retrievalQuery = buildRetrievalQuery(message, conversationHistory, currentPage);

	// Create a child run for Langsmith
	const childRun = await pipeline.createChild({
		name: 'MultiQueryRetriever',
		run_type: 'retriever',
		inputs: { message: retrievalQuery },
		client: langsmithClient
	});

	const imessageEnabled = await getImessageEnabled();

	// Always exclude iMessage docs from the main retriever. When iMessage is enabled,
	// those documents are fetched by the dedicated iMessage retriever below. When it's
	// disabled, they should never surface at all — regardless of what's in the collection.
	const mainRetrieverOptions = {
		k: 6,
		filter: {
			must_not: [{ key: 'metadata.source', match: { value: 'imessage' } }]
		}
	};

	const retriever = MultiQueryRetriever.fromLLM({
		llm: model,
		retriever: vectorStore.asRetriever(mainRetrieverOptions),
		verbose: false
	});

	// Run iMessage retrieval in parallel when enabled.
	// k=8 casts a wider net across long conversation histories so more topically
	// distinct chunks (e.g. work vs. side projects) can surface.
	const imessageRetrieverPromise = imessageEnabled
		? vectorStore
				.asRetriever({
					k: 8,
					filter: { must: [{ key: 'metadata.source', match: { value: 'imessage' } }] }
				})
				.getRelevantDocuments(retrievalQuery)
		: Promise.resolve([]);

	const [mainDocs, imessageDocs] = await Promise.all([
		retriever.getRelevantDocuments(retrievalQuery, {
			metadata: { conversation_id: runID }
		}),
		imessageRetrieverPromise
	]);

	const retrievedDocs = [...mainDocs, ...imessageDocs];

	// Log to Langsmith on completion
	childRun.end({ outputs: { answer: retrievedDocs } });
	await childRun.postRun();

	const deduplicated = deduplicateDocs(retrievedDocs);

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

		imessageParts.push(`[iMessage — ${label}]\n${parts.join('\n\n---\n\n')}`);
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
