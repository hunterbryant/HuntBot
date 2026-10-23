import { env } from '$env/dynamic/private';

const TIMEOUT_MS = 15_000;

/**
 * Run a HogQL query against the PostHog project and return rows as objects, or `null` when
 * `POSTHOG_PROJECT_ID` / `POSTHOG_PERSONAL_API_KEY` aren't set. Needs a personal API key with the
 * `query:read` scope. Pass user-controlled values through `values` (`{name}` placeholders in the
 * query), never by string interpolation. Always put a LIMIT and a `timestamp` bound in the query.
 */
export async function runHogQL<T = Record<string, unknown>>(
	query: string,
	values: Record<string, unknown> = {}
): Promise<T[] | null> {
	const projectId = env.POSTHOG_PROJECT_ID;
	const personalKey = env.POSTHOG_PERSONAL_API_KEY;
	if (!projectId || !personalKey) return null;

	const res = await fetch(`https://us.posthog.com/api/projects/${projectId}/query/`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${personalKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: { kind: 'HogQLQuery', query, values } }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) {
		const hint =
			res.status === 403 ? ' (does POSTHOG_PERSONAL_API_KEY have the query:read scope?)' : '';
		throw new Error(
			`PostHog query failed: ${res.status}${hint} ${(await res.text()).slice(0, 300)}`
		);
	}
	const data = (await res.json()) as { columns: string[]; results: unknown[][] };
	return data.results.map((row) =>
		Object.fromEntries(data.columns.map((col, i) => [col, row[i]]))
	) as T[];
}

/** Non-empty string, else null (HogQL returns '' for missing properties). */
export const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
/** Finite number, else null. */
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
