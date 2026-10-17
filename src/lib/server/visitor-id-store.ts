import { env } from '$env/dynamic/private';
import { getQdrantClient } from '$lib/server/qdrant-search';
import { createHash } from 'node:crypto';

// A tiny shared key-value store for company-identification records, in its own Qdrant collection
// (`<QDRANT_COLLECTION>_visitor_ids`, 1-dim dummy vectors), since serverless instances share no
// memory: the RB2B webhook lands on one instance and the chat turn that needs it on another.
// Two kinds of record:
// - `pixel`: page-view token -> company, written by the RB2B webhook, kept 24h
// - `referrer`: referrer host -> company (or none), written by the referrer classifier, kept 30 days
// Never throws: a missing store just means the layer stays quiet.

export type StoreKind = 'pixel' | 'referrer';
const TTL_MS: Record<StoreKind, number> = { pixel: 24 * 3600_000, referrer: 30 * 24 * 3600_000 };

const collection = () => (env.QDRANT_COLLECTION ? `${env.QDRANT_COLLECTION}_visitor_ids` : null);
let ready: Promise<boolean> | null = null;

function ensureCollection(): Promise<boolean> {
	const name = collection();
	if (!name || !env.QDRANT_URL) return Promise.resolve(false);
	ready ??= (async () => {
		const client = getQdrantClient();
		try {
			const { exists } = await client.collectionExists(name);
			if (!exists) {
				await client.createCollection(name, { vectors: { size: 1, distance: 'Dot' } });
			}
			return true;
		} catch (error) {
			ready = null; // try again on the next call
			console.warn('[HuntBot visitor-id] store unavailable', {
				error: error instanceof Error ? error.message.slice(0, 160) : String(error)
			});
			return false;
		}
	})();
	return ready;
}

/** Deterministic point id (Qdrant wants a UUID or an integer). */
function pointId(kind: StoreKind, key: string): string {
	const h = createHash('sha256').update(`${kind}:${key}`).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function putRecord(
	kind: StoreKind,
	key: string,
	value: Record<string, unknown>
): Promise<void> {
	if (!(await ensureCollection())) return;
	try {
		await getQdrantClient().upsert(collection()!, {
			points: [
				{ id: pointId(kind, key), vector: [1], payload: { kind, key, at: Date.now(), ...value } }
			]
		});
		// Occasional cleanup of expired records of this kind, so the collection stays small.
		if (Math.random() < 0.05) {
			await getQdrantClient()
				.delete(collection()!, {
					filter: {
						must: [
							{ key: 'kind', match: { value: kind } },
							{ key: 'at', range: { lt: Date.now() - TTL_MS[kind] } }
						]
					}
				})
				.catch(() => {});
		}
	} catch (error) {
		console.warn('[HuntBot visitor-id] store write failed', {
			kind,
			error: error instanceof Error ? error.message.slice(0, 160) : String(error)
		});
	}
}

/** The stored record, or null when there is none or it has expired. */
export async function getRecord(
	kind: StoreKind,
	key: string
): Promise<Record<string, unknown> | null> {
	if (!(await ensureCollection())) return null;
	try {
		const [point] = await getQdrantClient().retrieve(collection()!, {
			ids: [pointId(kind, key)],
			with_payload: true,
			with_vector: false
		});
		const payload = point?.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload.at !== 'number' || Date.now() - payload.at > TTL_MS[kind]) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}
