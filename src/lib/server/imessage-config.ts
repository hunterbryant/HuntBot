import { env } from '$env/dynamic/private';
import { QdrantClient } from '@qdrant/js-client-rest';

const CONFIG_POINT_ID = 'a0000000-0000-0000-0000-000000000001';
const VECTOR_DIMS = 512;
const CACHE_TTL_MS = 60_000;

let cached: boolean | null = null;
let cacheTime = 0;

function getClient(): QdrantClient {
	return new QdrantClient({
		url: env.QDRANT_URL,
		apiKey: env.QDRANT_API_KEY
	});
}

export async function getImessageEnabled(): Promise<boolean> {
	if (cached !== null && Date.now() - cacheTime < CACHE_TTL_MS) {
		return cached;
	}

	try {
		const client = getClient();
		const result = await client.retrieve(env.QDRANT_COLLECTION!, {
			ids: [CONFIG_POINT_ID],
			with_payload: true,
			with_vector: false
		});

		const value = result?.[0]?.payload?.imessageEnabled === true;
		cached = value;
		cacheTime = Date.now();
		return value;
	} catch {
		return cached ?? false;
	}
}

export async function setImessageEnabled(value: boolean): Promise<void> {
	const client = getClient();
	await client.upsert(env.QDRANT_COLLECTION!, {
		points: [
			{
				id: CONFIG_POINT_ID,
				vector: new Array(VECTOR_DIMS).fill(0),
				payload: { type: '_config', imessageEnabled: value }
			}
		]
	});
	cached = value;
	cacheTime = Date.now();
}
