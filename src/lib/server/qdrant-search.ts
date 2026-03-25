import { env } from '$env/dynamic/private';
import { Document } from '@langchain/core/documents';
import { QdrantClient } from '@qdrant/js-client-rest';

/** Must match @langchain/qdrant defaults used by embed pipelines */
const CONTENT_KEY = 'content';
const METADATA_KEY = 'metadata';

const CACHE_TTL_MS = 5 * 60_000;

type VectorNameCache = { collection: string; name: string | null; at: number };
let vectorNameCache: VectorNameCache | null = null;

function isVectorParams(v: unknown): v is { size: number } {
	return (
		typeof v === 'object' &&
		v !== null &&
		'size' in v &&
		typeof (v as { size: unknown }).size === 'number'
	);
}

export function getQdrantClient(): QdrantClient {
	return new QdrantClient({
		url: env.QDRANT_URL,
		apiKey: env.QDRANT_API_KEY
	});
}

/**
 * For dense vectors: `null` = legacy single (unnamed) vector — pass a raw float[] to search/upsert.
 * Otherwise the Qdrant named-vector key (e.g. `default`).
 */
async function resolveDenseVectorName(
	client: QdrantClient,
	collectionName: string
): Promise<string | null> {
	const explicit = env.QDRANT_VECTOR_NAME?.trim();
	if (explicit) {
		return explicit;
	}

	const now = Date.now();
	if (vectorNameCache?.collection === collectionName && now - vectorNameCache.at < CACHE_TTL_MS) {
		return vectorNameCache.name;
	}

	const info = await client.getCollection(collectionName);
	const vectors = info.config?.params?.vectors;

	let name: string | null = null;
	if (vectors && typeof vectors === 'object') {
		if (isVectorParams(vectors)) {
			name = null;
		} else {
			const o = vectors as Record<string, unknown>;
			const keys = Object.keys(o).filter((k) => isVectorParams(o[k]));
			if (keys.length > 0) {
				name = keys.includes('default') ? 'default' : (keys[0] ?? null);
			}
		}
	}

	vectorNameCache = { collection: collectionName, name, at: now };
	return name;
}

function toSearchVector(
	embedding: number[],
	named: string | null
): number[] | { name: string; vector: number[] } {
	if (!named) {
		return embedding;
	}
	return { name: named, vector: embedding };
}

/**
 * LangChain's QdrantVectorStore always sends an unnamed vector to `search()`, which breaks
 * collections that only define named dense vectors (Qdrant: "Not existing vector name").
 */
export async function qdrantSimilaritySearchWithScore(
	client: QdrantClient,
	collectionName: string,
	embedding: number[],
	k: number,
	filter?: Record<string, unknown>
): Promise<[Document, number][]> {
	const named = await resolveDenseVectorName(client, collectionName);
	const vector = toSearchVector(embedding, named);

	const results = await client.search(collectionName, {
		vector,
		limit: k,
		...(filter ? { filter } : {}),
		with_payload: [METADATA_KEY, CONTENT_KEY],
		with_vector: false
	});

	return results.map((res) => {
		const payload = (res.payload ?? {}) as Record<string, unknown>;
		const meta = payload[METADATA_KEY];
		const content = payload[CONTENT_KEY];
		return [
			new Document({
				metadata:
					typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {},
				pageContent: typeof content === 'string' ? content : ''
			}),
			res.score
		];
	});
}

/** Upsert payload `vector` field — unnamed array vs `{ [name]: array }` for named collections */
export async function getPointVectorForUpsert(
	client: QdrantClient,
	collectionName: string,
	embedding: number[]
): Promise<number[] | Record<string, number[]>> {
	const named = await resolveDenseVectorName(client, collectionName);
	if (!named) {
		return embedding;
	}
	return { [named]: embedding };
}
