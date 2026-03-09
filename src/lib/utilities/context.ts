import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { MultiQueryRetriever } from 'langchain/retrievers/multi_query';
import { Client } from 'langsmith';

export type Metadata = {
	url: string;
	text: string;
	chunk: string;
};

// The function `getContext` is used to retrieve the context of a given message
export const getContext = async (
	message: string,
	runID: string,
	pipeline: any,
	maxTokens = 20000
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

	// Create a child run for Langsmith
	const childRun = await pipeline.createChild({
		name: 'MultiQueryRetriever',
		run_type: 'retriever',
		inputs: { ...[message] },
		client: langsmithClient
	});

	const retriever = MultiQueryRetriever.fromLLM({
		llm: model,
		retriever: vectorStore.asRetriever(),
		verbose: false
	});

	const retrievedDocs = await retriever.getRelevantDocuments(message, {
		metadata: { conversation_id: runID }
	});

	// Log to Langsmith on completion
	childRun.end({ outputs: { answer: retrievedDocs } });
	await childRun.postRun();

	return JSON.stringify(retrievedDocs).substring(0, maxTokens);
};
