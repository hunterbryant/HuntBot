import { env } from '$env/dynamic/private';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import type { ScoredVector } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch';
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
): Promise<string | ScoredVector[]> => {
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
