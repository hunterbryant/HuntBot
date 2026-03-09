import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import type { Document } from '@langchain/core/documents';
import { compile } from 'html-to-text';
import { MultiQueryRetriever } from 'langchain/retrievers/multi_query';
import { Client } from 'langsmith';

export type Metadata = {
	url: string;
	text: string;
	chunk: string;
};

const convertHtml = compile({ wordwrap: 130 });
const SITE_ORIGIN = 'https://www.hunterbryant.io';

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

// Build an enriched retrieval query that incorporates recent conversation history.
// This helps MultiQueryRetriever handle follow-up questions like "tell me more about that"
// by giving it the conversational context it needs to generate useful query variants.
function buildRetrievalQuery(message: string, conversationHistory: string[]): string {
	if (!conversationHistory.length) return message;
	const historySnippet = conversationHistory.slice(-3).join(' | ');
	return `${historySnippet} | ${message}`;
}

// The function `getContext` is used to retrieve the context of a given message
export const getContext = async (
	message: string,
	runID: string,
	pipeline: any,
	conversationHistory: string[] = []
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

	const retrievalQuery = buildRetrievalQuery(message, conversationHistory);

	// Create a child run for Langsmith
	const childRun = await pipeline.createChild({
		name: 'MultiQueryRetriever',
		run_type: 'retriever',
		inputs: { message: retrievalQuery },
		client: langsmithClient
	});

	const retriever = MultiQueryRetriever.fromLLM({
		llm: model,
		retriever: vectorStore.asRetriever({ k: 6 }),
		verbose: false
	});

	const retrievedDocs = await retriever.getRelevantDocuments(retrievalQuery, {
		metadata: { conversation_id: runID }
	});

	// Log to Langsmith on completion
	childRun.end({ outputs: { answer: retrievedDocs } });
	await childRun.postRun();

	const deduplicated = deduplicateDocs(retrievedDocs);

	// Split retrieved docs into site pages (fetch full content) vs other sources (use chunks)
	const siteUrls = new Set<string>();
	const fallbackDocs: Document[] = [];

	for (const doc of deduplicated) {
		const source = doc.metadata?.source;
		if (typeof source === 'string' && source.startsWith(SITE_ORIGIN)) {
			siteUrls.add(source);
		} else {
			fallbackDocs.push(doc);
		}
	}

	// Fetch full page text for each matched site URL in parallel.
	// Multiple chunks from the same page collapse into one full fetch.
	const pageResults = await Promise.all(
		[...siteUrls].map(async (url) => {
			const text = await fetchFullPageText(url);
			return text ? `[${url}]\n${text}` : null;
		})
	);

	// Format fallback docs (Notion, text files) using their chunk content
	const fallbackParts = fallbackDocs.map((doc) => {
		const label = doc.metadata?.title || doc.metadata?.source || '';
		return label ? `[${label}]\n${doc.pageContent}` : doc.pageContent;
	});

	return [
		...pageResults.filter((r): r is string => r !== null),
		...fallbackParts
	].join('\n\n---\n\n');
};
