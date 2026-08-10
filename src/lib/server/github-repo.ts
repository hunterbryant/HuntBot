const REPO = 'hunterbryant/huntbot';
const BRANCH = 'main';
const MAX_CHARS = 8000;

/**
 * Fetches a file live from the HuntBot repo (unauthenticated — public repo) so the
 * chat tool always reflects the current code, no re-indexing step required.
 */
export async function readRepoFile(
	path: string
): Promise<{ content: string; truncated: boolean } | null> {
	// Path traversal / absolute-path guard — raw.githubusercontent.com would 404 on these
	// anyway, but reject before making the request.
	const cleaned = path.trim().replace(/^\/+/, '');
	if (!cleaned || cleaned.includes('..')) return null;

	const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${cleaned}`;

	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		const text = await res.text();
		const truncated = text.length > MAX_CHARS;
		return { content: truncated ? text.slice(0, MAX_CHARS) : text, truncated };
	} catch {
		return null;
	}
}
