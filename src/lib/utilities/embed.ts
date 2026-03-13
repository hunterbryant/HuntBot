import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type { TextSplitter } from 'langchain/text_splitter';
import { generateSparseVector } from './sparse.js';

const DENSE_SIZE = 512;
const BATCH_SIZE = 100;

export function makeEmbeddings(apiKey: string): OpenAIEmbeddings {
	return new OpenAIEmbeddings({
		modelName: 'text-embedding-3-small',
		openAIApiKey: apiKey,
		dimensions: DENSE_SIZE
	});
}

export async function ensureHybridCollection(
	client: QdrantClient,
	collectionName: string
): Promise<void> {
	const { collections } = await client.getCollections();
	if (collections.some((c) => c.name === collectionName)) return;
	await createHybridCollection(client, collectionName);
}

export async function createHybridCollection(
	client: QdrantClient,
	collectionName: string
): Promise<void> {
	await client.createCollection(collectionName, {
		vectors: { dense: { size: DENSE_SIZE, distance: 'Cosine' } },
		sparse_vectors: { sparse: {} }
	});
}

export async function upsertHybrid(
	docs: Document[],
	embeddings: OpenAIEmbeddings,
	config: { url: string; apiKey: string; collectionName: string }
): Promise<void> {
	const client = new QdrantClient({ url: config.url, apiKey: config.apiKey });
	await ensureHybridCollection(client, config.collectionName);

	const texts = docs.map((d) => d.pageContent);
	const denseVectors = await embeddings.embedDocuments(texts);

	for (let i = 0; i < docs.length; i += BATCH_SIZE) {
		const batch = docs.slice(i, i + BATCH_SIZE);
		const points = batch.map((doc, j) => ({
			id: crypto.randomUUID(),
			vector: {
				dense: denseVectors[i + j],
				sparse: generateSparseVector(doc.pageContent)
			},
			payload: {
				content: doc.pageContent,
				metadata: doc.metadata
			}
		}));
		await client.upsert(config.collectionName, { points, wait: true });
	}
}

export async function makeParentChildDocs(
	rawDocs: Document[],
	parentSplit: TextSplitter,
	childSplit: TextSplitter
): Promise<Document[]> {
	const parents = await parentSplit.splitDocuments(rawDocs);
	const children: Document[] = [];

	for (const parent of parents) {
		const parentText = parent.pageContent;
		const childDocs = await childSplit.splitDocuments([
			new Document({ pageContent: parentText, metadata: { ...parent.metadata } })
		]);
		for (const child of childDocs) {
			child.metadata.parentContent = parentText;
			children.push(child);
		}
	}

	return children;
}
