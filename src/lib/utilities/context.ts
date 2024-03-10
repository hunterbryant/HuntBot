import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { ScoredVector } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch';
import { getMatchesFromEmbeddings } from './pinecone';

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
	minScore = 0.6,
	getOnlyText = true
): Promise<string | ScoredVector[]> => {
	// Get the embeddings of the input message

	const embeddings = new OpenAIEmbeddings({
		modelName: 'text-embedding-ada-002',
		openAIApiKey: env.OPENAI_API_KEY
	});

	const embedding = await embeddings.embedQuery(message);

	// Retrieve the matches for the embeddings from the specified namespace
	const matches = await getMatchesFromEmbeddings(embedding, 40, namespace);

	// Filter out the matches that have a score lower than the minimum score
	const qualifyingDocs = matches.filter((m) => m.score && m.score > minScore);

	if (!getOnlyText) {
		// Use a map to deduplicate matches by URL
		return qualifyingDocs;
	}

	const docs = matches
		? qualifyingDocs.map((match) => {
				return (match.metadata as Metadata).text;
			})
		: [];

	console.log(docs);

	// Join all the chunks of text together, truncate to the maximum number of tokens, and return the result
	return docs.join('\n').substring(0, maxTokens);
};
