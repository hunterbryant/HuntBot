import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Document } from '@langchain/core/documents';
import { compile } from 'html-to-text';
import { getImessageEnabled } from '$lib/server/imessage-config';
import { logRag, shouldLogRag } from '$lib/server/rag-debug';
import { getQdrantClient, qdrantSimilaritySearchWithScore } from '$lib/server/qdrant-search';
import { rewriteRetrievalQuery } from '$lib/rewrite';
import { rerankChunks } from '$lib/server/rerank';

export type Metadata = {
	url: string;
	text: string;
	chunk: string;
};

const convertHtml = compile({ wordwrap: 130 });
const SITE_ORIGIN = 'https://www.hunterbryant.io';

// Pages that are listing/nav pages — not specific enough to force-fetch
const BROWSE_PAGES = new Set(['/', '/case-studies', '/projects', '/information']);

// Qdrant top-k per branch (main + iMessage); vector similarity floor
const QDRANT_TOP_K = 16;
const MIN_VECTOR_SCORE = 0.3;
const RERANK_TOP_K = 5;

type ScoredDoc = { doc: Document; vectorScore: number };

function shortHash(input: string): string {
	return createHash('sha256').update(input).digest('hex').slice(0, 10);
}

async function fetchFullPageText(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		const html = await res.text();
		return convertHtml(html).slice(0, 10000);
	} catch {
		return null;
	}
}

function dedupeScoredDocs(scored: ScoredDoc[]): ScoredDoc[] {
	const best = new Map<string, ScoredDoc>();
	for (const s of scored) {
		const key = (s.doc.metadata?.source ?? '') + s.doc.pageContent.slice(0, 80);
		const prev = best.get(key);
		if (!prev || s.vectorScore > prev.vectorScore) {
			best.set(key, s);
		}
	}
	return [...best.values()];
}

function scoredFromResults(results: [Document, number][]): ScoredDoc[] {
	return results.map(([doc, score]) => ({ doc, vectorScore: score }));
}

/** Stable id for citation (must match text shown to the model). */
function chunkIdForSite(source: string, seq: number): string {
	return `CHUNK-site-${shortHash(source)}-${seq}`;
}

function chunkIdForNotes(doc: Document, seq: number): string {
	const src = String(doc.metadata?.source ?? doc.metadata?.title ?? 'doc');
	return `CHUNK-notes-${shortHash(src + doc.pageContent.slice(0, 48))}-${seq}`;
}

function chunkIdForImessage(chatId: string, seq: number): string {
	return `CHUNK-imsg-${chatId}-${seq}`;
}

function getEmbeddings(): OpenAIEmbeddings {
	return new OpenAIEmbeddings({
		modelName: 'text-embedding-3-small',
		openAIApiKey: env.OPENAI_API_KEY,
		dimensions: 512
	});
}

async function similaritySearchWithScore(
	query: string,
	k: number,
	filter?: Record<string, unknown>
): Promise<[Document, number][]> {
	const embeddings = getEmbeddings();
	const embedding = await embeddings.embedQuery(query);
	const client = getQdrantClient();
	const collection = env.QDRANT_COLLECTION;
	if (!collection) {
		throw new Error('QDRANT_COLLECTION is not set');
	}
	return qdrantSimilaritySearchWithScore(client, collection, embedding, k, filter);
}

/**
 * Extract a person name from the query for entity-aware search.
 * Returns null if no person-lookup pattern is detected.
 */
function extractPersonName(query: string): string | null {
	const patterns = [
		/who\s+is\s+(\w+(?:\s+\w+)?)/i,
		/tell\s+me\s+about\s+(\w+(?:\s+\w+)?)/i,
		/what\s+(?:does|did|is|about)\s+(\w+(?:\s+\w+)?)\s/i,
		/(\w+(?:\s+\w+)?)[''']s\s+(?:project|work|job|life|texts?|messages?)/i
	];
	for (const p of patterns) {
		const m = query.match(p);
		if (m?.[1] && m[1].length > 2) {
			logRag('entity extraction', { name: m[1] });
			return m[1];
		}
	}
	return null;
}

/**
 * Limit chunks per source to improve diversity.
 * Keeps only the first `maxPerSource` chunks from each unique source URL.
 */
function diversifyBySource(docs: Document[], maxPerSource: number = 2): Document[] {
	const counts = new Map<string, number>();
	return docs.filter((doc) => {
		const src = doc.metadata?.source ?? '';
		const count = counts.get(src) ?? 0;
		if (count >= maxPerSource) return false;
		counts.set(src, count + 1);
		return true;
	});
}

/** Apply reranking if enabled, otherwise truncate to top K. */
async function maybeRerank(
	query: string,
	docs: Document[],
	topK: number
): Promise<Document[]> {
	const shouldRerank = env.RERANK_ENABLED !== '0';
	if (shouldRerank) {
		return rerankChunks(query, docs, topK);
	}
	return docs.slice(0, topK);
}

export const getContext = async (
	message: string,
	conversationHistory: string[] = [],
	currentPage: string = '/'
): Promise<string> => {
	const retrievalQuery = await rewriteRetrievalQuery(message, conversationHistory, currentPage);
	logRag('getContext retrieval query', {
		rewritten: retrievalQuery.slice(0, 200),
		priorTurns: conversationHistory.length
	});

	const imessageEnabled = await getImessageEnabled();

	const mainFilter = {
		must_not: [{ key: 'metadata.source', match: { value: 'imessage' } }]
	};
	const imessageFilter = {
		must: [{ key: 'metadata.source', match: { value: 'imessage' } }]
	};

	// Entity-aware search: if the query mentions a person, run a filtered search
	const personName = extractPersonName(retrievalQuery);
	const personFilter = personName
		? {
				should: [
					{ key: 'metadata.contact', match: { text: personName } },
					{ key: 'metadata.participants', match: { text: personName } }
				]
			}
		: null;

	const [mainResults, imessageResults, personResults] = await Promise.all([
		similaritySearchWithScore(retrievalQuery, QDRANT_TOP_K, mainFilter),
		imessageEnabled
			? similaritySearchWithScore(retrievalQuery, QDRANT_TOP_K, imessageFilter)
			: Promise.resolve([] as [Document, number][]),
		personFilter
			? similaritySearchWithScore(retrievalQuery, 8, personFilter)
			: Promise.resolve([] as [Document, number][])
	]);

	let combined = [
		...scoredFromResults(mainResults),
		...scoredFromResults(imessageResults),
		...scoredFromResults(personResults)
	];

	combined = combined.filter((s) => s.vectorScore >= MIN_VECTOR_SCORE);

	if (combined.length === 0 && mainResults.length + imessageResults.length > 0) {
		const fallback = [...mainResults, ...imessageResults].sort((a, b) => b[1] - a[1]);
		combined = scoredFromResults([fallback[0]]);
	}

	const deduped = dedupeScoredDocs(combined);
	const sorted = deduped.sort((a, b) => b.vectorScore - a.vectorScore).map((s) => s.doc);

	// Rerank, then diversify by source
	const reranked = await maybeRerank(retrievalQuery, sorted, RERANK_TOP_K);
	const docs = diversifyBySource(reranked);

	const MAX_IMESSAGE_CHUNKS_PER_CHAT = 2;
	const siteUrls = new Map<string, string>();
	const imessageChatChunks = new Map<string, Document[]>();
	const fallbackDocs: { doc: Document; chunkId: string }[] = [];

	let siteSeq = 0;
	let notesSeq = 0;

	for (const doc of docs) {
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
			if (!siteUrls.has(source)) {
				siteUrls.set(source, chunkIdForSite(source, siteSeq++));
			}
		} else {
			fallbackDocs.push({ doc, chunkId: chunkIdForNotes(doc, notesSeq++) });
		}
	}

	const imessageParts: string[] = [];
	let imsgSeq = 0;
	for (const [, chunks] of imessageChatChunks) {
		const meta = chunks[0].metadata ?? {};
		const chatId = String(meta.chatId ?? 'unknown');
		const chunkId = chunkIdForImessage(chatId, imsgSeq++);
		const label =
			meta.isGroupChat === 1 && meta.participants ? meta.participants : (meta.contact ?? 'unknown');
		const primaryContext = meta.expandedContext || chunks[0].pageContent;
		const parts = [primaryContext];

		for (let i = 1; i < chunks.length; i++) {
			const extra = chunks[i].pageContent;
			if (!primaryContext.includes(extra.slice(0, 80))) {
				parts.push(extra);
			}
		}

		const dateInfo = meta.dateRange ? ` (${meta.dateRange})` : '';
		const msgCount = meta.messageCount ? ` — ${meta.messageCount} messages` : '';
		const participantLine =
			meta.isGroupChat === 1 && meta.participants ? `Participants: ${meta.participants}\n` : '';
		const headerLine = `[${chunkId}] Conversation: ${label}${dateInfo}${msgCount}`;
		imessageParts.push(`${headerLine}\n${participantLine}${parts.join('\n\n---\n\n')}`);
	}

	if (currentPage && !BROWSE_PAGES.has(currentPage)) {
		const url = `${SITE_ORIGIN}${currentPage}`;
		if (!siteUrls.has(url)) {
			siteUrls.set(url, chunkIdForSite(url, siteSeq++));
		}
	}

	const pageResults = await Promise.all(
		[...siteUrls.entries()].map(async ([url, chunkId]) => {
			const text = await fetchFullPageText(url);
			return text ? { chunkId, url, text } : null;
		})
	);

	const fallbackParts = fallbackDocs.map(({ doc, chunkId }) => {
		const label = doc.metadata?.title || doc.metadata?.source || '';
		const body = label ? `[${label}]\n${doc.pageContent}` : doc.pageContent;
		return `[${chunkId}]\n${body}`;
	});

	const sections: string[] = [];

	const siteContent = pageResults.filter((r): r is NonNullable<typeof r> => r !== null);
	if (siteContent.length > 0) {
		sections.push(
			`### SITE CONTENT (pages from hunterbryant.io)\n${siteContent
				.map((r) => `[${r.chunkId}] Source: ${r.url}\n${r.text}`)
				.join('\n\n---\n\n')}`
		);
	}

	if (fallbackParts.length > 0) {
		sections.push(`### NOTES & DOCUMENTS\n${fallbackParts.join('\n\n---\n\n')}`);
	}

	if (imessageParts.length > 0) {
		sections.push(
			`### IMESSAGE CONVERSATIONS (private text messages — separate source from above)\n${imessageParts.join('\n\n---\n\n')}`
		);
	}

	const contextText = sections.join('\n\n========\n\n');
	if (shouldLogRag()) {
		console.log(`[HuntBot RAG] getContext — retrieved context (${contextText.length} chars)`);
		console.log(contextText.length > 0 ? contextText : '(empty — no sections matched filters)');
	}
	return contextText;
};

export async function searchKnowledgeBase(
	query: string,
	sourceFilter: 'all' | 'imessage' | 'site' = 'all'
): Promise<string> {
	logRag('searchKnowledgeBase', { query: query.slice(0, 200), source_filter: sourceFilter });

	let filter: Record<string, unknown> | undefined;
	if (sourceFilter === 'imessage') {
		filter = { must: [{ key: 'metadata.source', match: { value: 'imessage' } }] };
	} else if (sourceFilter === 'site') {
		filter = { must_not: [{ key: 'metadata.source', match: { value: 'imessage' } }] };
	}

	const raw = await similaritySearchWithScore(query, QDRANT_TOP_K, filter);
	let scored = scoredFromResults(raw).filter((s) => s.vectorScore >= MIN_VECTOR_SCORE);

	if (scored.length === 0 && raw.length > 0) {
		raw.sort((a, b) => b[1] - a[1]);
		scored = scoredFromResults([raw[0]]);
	}

	const deduped = dedupeScoredDocs(scored).sort((a, b) => b.vectorScore - a.vectorScore);
	const docs = deduped.map((s) => s.doc);

	// Rerank and diversify
	const reranked = await maybeRerank(query, docs, RERANK_TOP_K);
	const ranked = diversifyBySource(reranked);

	if (ranked.length === 0) {
		return 'No relevant results found for this query.';
	}

	let nSeq = 0;
	return ranked
		.map((doc) => {
			const source = doc.metadata?.source ?? 'unknown';
			const label = doc.metadata?.title || doc.metadata?.contact || source;
			let cid: string;
			if (source === 'imessage') {
				cid = chunkIdForImessage(String(doc.metadata?.chatId ?? 'unknown'), nSeq++);
			} else if (typeof source === 'string' && source.startsWith(SITE_ORIGIN)) {
				cid = chunkIdForSite(source, nSeq++);
			} else {
				cid = chunkIdForNotes(doc, nSeq++);
			}
			// Find the original score from deduped array
			const scoredEntry = deduped.find((s) => s.doc === doc);
			const vs = scoredEntry ? scoredEntry.vectorScore.toFixed(3) : '—';
			return `[${cid}] ${label} (vector: ${vs})\n${doc.pageContent}`;
		})
		.join('\n\n---\n\n');
}
