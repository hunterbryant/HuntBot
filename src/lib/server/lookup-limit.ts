// Each company lookup can start a paid web-search agent, so cap how often one address can trigger
// one (per warm instance; a determined script can still spread across instances, but not
// unboundedly). Used by the role opener and by `/simulate` in the chat route.
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();

export function allowLookup(ip: string | null): boolean {
	const key = ip ?? 'unknown';
	const now = Date.now();
	const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= MAX_PER_WINDOW) return false;
	recent.push(now);
	hits.set(key, recent);
	if (hits.size > 2000) hits.delete(hits.keys().next().value as string);
	return true;
}
