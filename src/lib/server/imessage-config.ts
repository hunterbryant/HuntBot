import { readConfigPoint, writeConfigPoint } from '$lib/server/qdrant-search';

export const CONFIG_POINT_ID = 'a0000000-0000-0000-0000-000000000001';
const CACHE_TTL_MS = 60_000;

let cached: boolean | null = null;
let cacheTime = 0;

export async function getImessageEnabled(): Promise<boolean> {
	if (cached !== null && Date.now() - cacheTime < CACHE_TTL_MS) {
		return cached;
	}

	try {
		const payload = await readConfigPoint(CONFIG_POINT_ID);
		const value = payload?.imessageEnabled === true;
		cached = value;
		cacheTime = Date.now();
		return value;
	} catch {
		return cached ?? false;
	}
}

export async function setImessageEnabled(value: boolean): Promise<void> {
	await writeConfigPoint(CONFIG_POINT_ID, { imessageEnabled: value });
	cached = value;
	cacheTime = Date.now();
}
