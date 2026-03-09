import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { json } from '@sveltejs/kit';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { TokenTextSplitter } from 'langchain/text_splitter';

//Handle uploading of text documents to Qdrant
export async function GET() {
	console.log('Server text embed endpoint hit');

	const directoryPath = 'local_files/texts';

	const loader = new DirectoryLoader(directoryPath, {
		'.txt': (path) => new TextLoader(path),
		'.csv': (path) => new CSVLoader(path, 'text')
	});

	const splitter = new TokenTextSplitter({
		encodingName: 'gpt2',
		chunkSize: 500,
		chunkOverlap: 250
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

	return json('Embedded text docs', { status: 200 });
}
