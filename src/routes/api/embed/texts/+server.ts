import { env } from '$env/dynamic/private';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { json } from '@sveltejs/kit';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { TokenTextSplitter } from 'langchain/text_splitter';

//Handle uploading of Notion DB documents to Pinecone
export async function GET() {
	console.log('Server text embed endpoint hit');

	// Obtain a client for Pinecone
	const pinecone = new Pinecone({
		apiKey: env.PINECONE_API_KEY
	});

	const pineconeIndex = pinecone.Index(env.PINECONE_INDEX);

	const directoryPath = 'local_files/email';

	const loader = new DirectoryLoader(directoryPath, {
		'.txt': (path) => new TextLoader(path),
		'.csv': (path) => new CSVLoader(path, 'text')
	});

	const splitter = new TokenTextSplitter({
		encodingName: 'gpt2',
		chunkSize: 1000,
		chunkOverlap: 250
	});

	const docs = await loader.loadAndSplit(splitter);

	await PineconeStore.fromDocuments(
		docs,
		new OpenAIEmbeddings({
			modelName: 'text-embedding-3-small',
			openAIApiKey: env.OPENAI_API_KEY
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
