import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { compile } from 'html-to-text';
import { RecursiveUrlLoader } from 'langchain/document_loaders/web/recursive_url';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { upsertHybrid, makeEmbeddings, makeParentChildDocs } from '$lib/utilities/embed.js';

export async function GET(event) {
	console.log('Server url list embed API endpoint hit');

	const entryURL = 'https://www.hunterbryant.io/';
	const compiledConvert = compile({ wordwrap: 130 });

	const loader = new RecursiveUrlLoader(entryURL, {
		extractor: compiledConvert,
		maxDepth: 3,
		excludeDirs: []
	});

	const parentSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1500, chunkOverlap: 100 });
	const childSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 300, chunkOverlap: 30 });

	const rawDocs = await loader.load();
	const docs = await makeParentChildDocs(rawDocs, parentSplitter, childSplitter);

	const now = new Date().toISOString();
	for (const doc of docs) {
		doc.metadata.embeddedDate = now;
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

	return json('Embedded recursive urls', { status: 200 });
}
