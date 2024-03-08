import { env } from '$env/dynamic/private';
import { Pinecone } from '@pinecone-database/pinecone';

import { NotionAPILoader } from 'langchain/document_loaders/web/notionapi';

import { PineconeStore } from '@langchain/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

//Handle uploading of Notion DB documents to Pinecone
export async function GET(event) {
	console.log('Server Notion embed API endpoint hit');

	// Instantiate a new Pinecone client, which will automatically read the
	// env vars: PINECONE_API_KEY and PINECONE_ENVIRONMENT which come from
	// the Pinecone dashboard at https://app.pinecone.io

	// Obtain a client for Pinecone
	const pinecone = new Pinecone({
		apiKey: env.PINECONE_API_KEY
	});

	const pineconeIndex = pinecone.Index(env.PINECONE_INDEX);

	// Loading a page (including child pages all as separate documents)
	const dbLoader = new NotionAPILoader({
		clientOptions: {
			auth: env.NOTION_INTEGRATION_TOKEN
		},
		// id: '637fbb5a0236401fa1ee8e5e05775b5e',
		id: '879d16ea6bdd45b3ad83bc0157cfb254',
		type: 'database',
		onDocumentLoaded: (current, total, currentTitle) => {
			console.log(`Loaded Page: ${currentTitle} (${current}/${total})`);
		},
		callerOptions: {
			maxConcurrency: 64 // Default value
		},
		propertiesAsHeader: true // Prepends a front matter header of the page properties to the page contents
	});

	// Chunking options
	const splitter = new MarkdownTextSplitter({
		chunkSize: 1000,
		chunkOverlap: 200
	});

	// A database row contents is likely to be less than 1000 characters so it's not split into multiple documents
	const dbDocs = await dbLoader.loadAndSplit(splitter);

	await PineconeStore.fromDocuments(dbDocs, new OpenAIEmbeddings({
		openAIApiKey: env.OPENAI_API_KEY
	}), {
		pineconeIndex,
		maxConcurrency: 5 // Maximum number of batch requests to allow at once. Each batch is 1000 vectors.
	}).then(() => console.log('Embeddings loaded')).catch((err) => {
		console.log(error);
		return json(
			{ error: `Failed to load embeddings: ${error}` },
			{ status: 500 }
		);
	});

	return json('Embedded Notion docs', { status: 200 });
}