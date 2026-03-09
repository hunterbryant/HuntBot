import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { MultiQueryRetriever } from 'langchain/retrievers/multi_query';
import { Client } from 'langsmith';
import type { Document } from '@langchain/core/documents';

export type Metadata = {
	url: string;
	text: string;
	chunk: string;
};

// Format retrieved docs as clean readable text with source attribution.
// Deduplicates chunks by URL + content fingerprint to avoid redundant context.
function formatDocs(docs: Document[]): string {
	const seen = new Set<string>();

	return docs
		.filter((doc) => {
			const key = (doc.metadata?.url ?? '') + doc.pageContent.slice(0, 80);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.map((doc) => {
			const source = doc.metadata?.url ? `[${doc.metadata.url}]` : '';
			return source ? `${source}\n${doc.pageContent}` : doc.pageContent;
		})
		.join('\n\n---\n\n');
}

// Build an enriched retrieval query that incorporates recent conversation history.
// This helps MultiQueryRetriever handle follow-up questions like "tell me more about that"
// by giving it the conversational context it needs to generate useful query variants.
function buildRetrievalQuery(message: string, conversationHistory: string[]): string {
	if (!conversationHistory.length) return message;
	// Use up to the last 3 prior user messages as context prefix
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

	return formatDocs(retrievedDocs);
};
