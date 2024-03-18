import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import type { ScoredVector } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch';
import { MultiQueryRetriever } from 'langchain/retrievers/multi_query';

export type Metadata = {
	url: string;
	text: string;
	chunk: string;
};

// The function `getContext` is used to retrieve the context of a given message
export const getContext = async (
	message: string,
	runID: string,
	maxTokens = 20000
): Promise<string | ScoredVector[]> => {
	process.env.LANGCHAIN_TRACING_V2 = 'true';
	process.env.LANGCHAIN_API_KEY = env.LANGCHAIN_API_KEY;

	// Obtain a client for Pinecone
	const pinecone = new Pinecone({
		apiKey: env.PINECONE_API_KEY
	});
	const pineconeIndex = pinecone.Index(env.PINECONE_INDEX);
	const vectorStore = await PineconeStore.fromExistingIndex(
		new OpenAIEmbeddings({
			modelName: 'text-embedding-3-small',
			openAIApiKey: env.OPENAI_API_KEY,
			dimensions: 512
		}),
		{ pineconeIndex }
	);

	const model = new ChatOpenAI({
		openAIApiKey: env.OPENAI_API_KEY
	});

	const retriever = MultiQueryRetriever.fromLLM({
		llm: model,
		retriever: vectorStore.asRetriever(),
		verbose: false
	});

	const retrievedDocs = await retriever.getRelevantDocuments(message, {
		metadata: { conversation_id: runID }
	});

	return retrievedDocs.join('\n').substring(0, maxTokens);
};
