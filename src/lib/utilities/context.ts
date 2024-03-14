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
	namespace: string,
	maxTokens = 20000,
	minScore = 0.5,
	getOnlyText = true
): Promise<string | ScoredVector[]> => {
	// Get the embeddings of the input message

	// const embeddings = new OpenAIEmbeddings({
	// 	modelName: 'text-embedding-3-small',
	// 	openAIApiKey: env.OPENAI_API_KEY,
	// 	dimensions: 512
	// });

	// const embedding = await embeddings.embedQuery(message);

	// // Retrieve the matches for the embeddings from the specified namespace
	// const matches = await getMatchesFromEmbeddings(embedding, 10, namespace);

	// // Filter out the matches that have a score lower than the minimum score
	// const qualifyingDocs = matches.filter((m) => m.score && m.score > minScore);

	// if (!getOnlyText) {
	// 	// Use a map to deduplicate matches by URL
	// 	return qualifyingDocs;
	// }

	// const docs = matches
	// 	? qualifyingDocs.map((match) => {
	// 			return (match.metadata as Metadata).text;
	// 		})
	// 	: [];

	// // Join all the chunks of text together, truncate to the maximum number of tokens, and return the result
	// return docs.join('\n').substring(0, maxTokens);

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

	const retrievedDocs = await retriever.getRelevantDocuments(message);

	return retrievedDocs.join('\n').substring(0, maxTokens);
};
