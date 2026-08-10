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

export type RepoCommit = {
	sha: string;
	message: string;
	author: string;
	date: string;
};

/**
 * Fetches the most recent commits on `main` via GitHub's REST API (unauthenticated —
 * public repo, subject to GitHub's ~60 req/hr unauthenticated rate limit). GitHub
 * requires a User-Agent header on API requests or it rejects them outright.
 */
export async function getRecentCommits(limit = 5): Promise<RepoCommit[] | null> {
	const url = `https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=${limit}`;

	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'huntbot' },
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return null;

		const data: Array<{
			sha: string;
			commit: { message: string; author: { name: string; date: string } };
		}> = await res.json();

		return data.map((c) => ({
			sha: c.sha.slice(0, 7),
			message: c.commit.message.split('\n')[0],
			author: c.commit.author.name,
			date: c.commit.author.date
		}));
	} catch {
		return null;
	}
}
