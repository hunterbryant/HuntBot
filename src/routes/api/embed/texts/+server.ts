import { statSync } from 'fs';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { CSVLoader } from 'langchain/document_loaders/fs/csv';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { upsertHybrid, makeEmbeddings, makeParentChildDocs } from '$lib/utilities/embed.js';

//Handle uploading of text documents to Qdrant
export async function GET() {
	console.log('Server text embed endpoint hit');

	const directoryPath = 'local_files/texts';

	const loader = new DirectoryLoader(directoryPath, {
		'.txt': (path) => new TextLoader(path),
		'.csv': (path) => new CSVLoader(path, 'text')
	});

	const parentSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1500, chunkOverlap: 100 });
	const childSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 300, chunkOverlap: 30 });

	const rawDocs = await loader.load();
	const docs = await makeParentChildDocs(rawDocs, parentSplitter, childSplitter);

	const fileTimeCache = new Map<string, string>();
	for (const doc of docs) {
		const filePath = doc.metadata?.source as string;
		if (filePath && !fileTimeCache.has(filePath)) {
			try {
				fileTimeCache.set(filePath, statSync(filePath).mtime.toISOString());
			} catch {
				fileTimeCache.set(filePath, new Date().toISOString());
			}
		}
		doc.metadata.embeddedDate = fileTimeCache.get(filePath ?? '') ?? new Date().toISOString();
	}

	const embeddings = makeEmbeddings(env.OPENAI_API_KEY);
	const qdrantConfig = {
		url: env.QDRANT_URL,
		apiKey: env.QDRANT_API_KEY,
		collectionName: env.QDRANT_COLLECTION
	};

	try {
		await upsertHybrid(docs, embeddings, qdrantConfig);
		console.log('Embeddings loaded');
	} catch (error) {
		console.log(error);
		return json({ error: `Failed to load embeddings: ${error}` }, { status: 500 });
	}

	return json('Embedded text docs', { status: 200 });
}
