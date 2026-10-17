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

const names = new Map<string, Map<string, number>>();

/**
 * Like `allowLookup`, but a company name this address already used in the window is free, so a
 * visitor keeps their stated or simulated company across every turn of a chat; only each *new*
 * name counts against the limit (a script cycling made-up names runs out after 8).
 */
export function allowCompany(ip: string | null, name: string): boolean {
	const key = ip ?? 'unknown';
	const now = Date.now();
	const mine = names.get(key) ?? new Map<string, number>();
	for (const [n, at] of mine) if (now - at >= WINDOW_MS) mine.delete(n);
	const norm = name.toLowerCase();
	if (mine.has(norm)) {
		mine.set(norm, now);
		return true;
	}
	if (mine.size >= MAX_PER_WINDOW) return false;
	mine.set(norm, now);
	names.set(key, mine);
	if (names.size > 2000) names.delete(names.keys().next().value as string);
	return true;
}
