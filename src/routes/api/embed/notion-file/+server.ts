import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { json } from '@sveltejs/kit';
import { NotionLoader } from 'langchain/document_loaders/fs/notion';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

//Handle uploading of Notion DB documents to Pinecone
export async function GET() {
	console.log('Server Notion file endpoint hit');

	// Obtain a client for Pinecone
	const pinecone = new Pinecone({
		apiKey: env.PINECONE_API_KEY
	});

	const pineconeIndex = pinecone.Index(env.PINECONE_INDEX);

	const directoryPath = 'local_files/notion_export';
	const loader = new NotionLoader(directoryPath);

	// Chunking options
	const splitter = new MarkdownTextSplitter({
		chunkSize: 1000,
		chunkOverlap: 200
	});

	const docs = await loader.loadAndSplit(splitter);

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

	return json('Embedded Notion file docs', { status: 200 });
}
