const REPO = 'hunterbryant/huntbot';
const BRANCH = 'main';
const MAX_CHARS = 8000;

// GitHub rejects API requests without a User-Agent; unauthenticated REST calls share a
// ~60 req/hr rate limit, and /search/code has its own tighter ~10 req/min limit.
async function githubApiFetch(url: string): Promise<Response | null> {
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'huntbot' },
			signal: AbortSignal.timeout(5000)
		});
		return res.ok ? res : null;
	} catch {
		return null;
	}
}

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
	const res = await githubApiFetch(url);
	if (!res) return null;

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
}

export type RepoInfo = {
	createdAt: string;
	pushedAt: string;
	sizeKb: number;
	stars: number;
	openIssues: number;
	defaultBranch: string;
	languages: Array<{ name: string; percent: number }>;
};

/** High-level repo facts (age, size, language breakdown) via GitHub's REST API. */
export async function getRepoInfo(): Promise<RepoInfo | null> {
	const [repoRes, langRes] = await Promise.all([
		githubApiFetch(`https://api.github.com/repos/${REPO}`),
		githubApiFetch(`https://api.github.com/repos/${REPO}/languages`)
	]);
	if (!repoRes) return null;

	const repo: {
		created_at: string;
		pushed_at: string;
		size: number;
		stargazers_count: number;
		open_issues_count: number;
		default_branch: string;
	} = await repoRes.json();

	let languages: Array<{ name: string; percent: number }> = [];
	if (langRes) {
		const bytes: Record<string, number> = await langRes.json();
		const total = Object.values(bytes).reduce((sum, n) => sum + n, 0);
		if (total > 0) {
			languages = Object.entries(bytes)
				.map(([name, n]) => ({ name, percent: Math.round((n / total) * 100) }))
				.sort((a, b) => b.percent - a.percent);
		}
	}

	return {
		createdAt: repo.created_at,
		pushedAt: repo.pushed_at,
		sizeKb: repo.size,
		stars: repo.stargazers_count,
		openIssues: repo.open_issues_count,
		defaultBranch: repo.default_branch,
		languages
	};
}

export type CodeSearchResult = { path: string; url: string };

/** Searches file paths/contents in the repo via GitHub's code search API. */
export async function searchRepoCode(query: string, limit = 8): Promise<CodeSearchResult[] | null> {
	const q = `${query} repo:${REPO}`;
	const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`;
	const res = await githubApiFetch(url);
	if (!res) return null;

	const data: { items: Array<{ path: string; html_url: string }> } = await res.json();
	return data.items.map((item) => ({ path: item.path, url: item.html_url }));
}
