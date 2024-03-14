// import { crawlDocument } from '$lib/utilities/setupContext';
// import { urls } from '$lib/utilities/urls';
import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { json } from '@sveltejs/kit';
import { compile } from 'html-to-text';
import { RecursiveUrlLoader } from 'langchain/document_loaders/web/recursive_url';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

export async function GET(event) {
	console.log('Server url list embed API endpoint hit');

	const entryURL = 'https://www.hunterbryant.io/';
	const compiledConvert = compile({ wordwrap: 130 }); // returns (text: string) => string;

	const loader = new RecursiveUrlLoader(entryURL, {
		extractor: compiledConvert,
		maxDepth: 3,
		excludeDirs: []
	});

	// Chunking options
	const splitter = new MarkdownTextSplitter({
		chunkSize: 1000,
		chunkOverlap: 200
	});

	// A database row contents is likely to be less than 1000 characters so it's not split into multiple documents
	const docs = await loader.loadAndSplit(splitter);

	// Obtain a client for Pinecone
	const pinecone = new Pinecone({
		apiKey: env.PINECONE_API_KEY
	});

	const pineconeIndex = pinecone.Index(env.PINECONE_INDEX);

	await PineconeStore.fromDocuments(
		docs,
		new OpenAIEmbeddings({
			modelName: 'text-embedding-3-small',
			openAIApiKey: env.OPENAI_API_KEY,
			dimensions: 512
		}),
		{
			pineconeIndex,
			maxConcurrency: 5 // Maximum number of batch requests to allow at once. Each batch is 1000 vectors.
		}
	)
		.then(() => console.log('Embeddings loaded'))
		.catch((error) => {
			console.log(error);
			return json({ error: `Failed to load embeddings: ${error}` }, { status: 500 });
		});

	return json('Embedded recursive urls', { status: 200 });
}
