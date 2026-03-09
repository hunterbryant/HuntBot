import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { json } from '@sveltejs/kit';
import { NotionLoader } from 'langchain/document_loaders/fs/notion';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

//Handle uploading of Notion DB documents to Qdrant
export async function GET() {
	console.log('Server Notion file endpoint hit');

	const directoryPath = 'local_files/notion_export';
	const loader = new NotionLoader(directoryPath);

	// Chunking options
	const splitter = new MarkdownTextSplitter({
		chunkSize: 1000,
		chunkOverlap: 200
	});

	const docs = await loader.loadAndSplit(splitter);

	await QdrantVectorStore.fromDocuments(
		docs,
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
	)
		.then(() => console.log('Embeddings loaded'))
		.catch((error) => {
			console.log(error);
			return json({ error: `Failed to load embeddings: ${error}` }, { status: 500 });
		});

	return json('Embedded Notion file docs', { status: 200 });
}
