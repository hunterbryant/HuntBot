import { env } from '$env/dynamic/private';
import { getPointVectorForUpsert, getQdrantClient } from '$lib/server/qdrant-search';

const CONFIG_POINT_ID = 'b0000000-0000-0000-0000-000000000002';
const VECTOR_DIMS = 512;
const CACHE_TTL_MS = 60_000;

interface StatusData {
	text: string;
	updatedAt: string;
}

let cached: StatusData | null = null;
let cacheTime = 0;

export async function getStatus(): Promise<StatusData | null> {
	if (cached !== null && Date.now() - cacheTime < CACHE_TTL_MS) {
		return cached;
	}

	try {
		const client = getQdrantClient();
		const result = await client.retrieve(env.QDRANT_COLLECTION!, {
			ids: [CONFIG_POINT_ID],
			with_payload: true,
			with_vector: false
		});

		const payload = result?.[0]?.payload;
		if (!payload?.statusText || typeof payload.statusText !== 'string') {
			cached = null;
			cacheTime = Date.now();
			return null;
		}

		const data: StatusData = {
			text: payload.statusText as string,
			updatedAt: (payload.updatedAt as string) || new Date().toISOString()
		};
		cached = data;
		cacheTime = Date.now();
		return data;
	} catch {
		return cached ?? null;
	}
}

export async function setStatus(text: string): Promise<void> {
	const client = getQdrantClient();
	const collection = env.QDRANT_COLLECTION!;
	const zeroVec = new Array(VECTOR_DIMS).fill(0);
	const vector = await getPointVectorForUpsert(client, collection, zeroVec);
	const updatedAt = new Date().toISOString();

	await client.upsert(collection, {
		points: [
			{
				id: CONFIG_POINT_ID,
				vector,
				payload: { type: '_config', statusText: text, updatedAt }
			}
		]
	});

	if (text) {
		cached = { text, updatedAt };
	} else {
		cached = null;
	}
	cacheTime = Date.now();
}
