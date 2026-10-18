import { env } from '$env/dynamic/private';
import { oneLine } from '$lib/server/clean-text';
import { coreOrgName, type IpOrg } from '$lib/server/ip-org';
import { resolvePublicHost, safeFetchText } from '$lib/server/safe-fetch';
import { describeError } from '$lib/server/tool-log';
import { getRecord, putRecord } from '$lib/server/visitor-id-store';
import { warnOnce } from '$lib/server/warn-once';
import { createOpenAI } from '@ai-sdk/openai';
import { waitUntil } from '@vercel/functions';
import { generateText, Output, tool, zodSchema } from 'ai';
import { compile } from 'html-to-text';
import { z } from 'zod';

// Open design roles at the company a visitor's network belongs to, so HuntBot can ask "are you
// hiring for the Maps designer role?" instead of guessing blind. The network owner comes from the
// IPinfo lookup (ip-org.ts) and is only a guess: VPNs, coworking spaces and parent companies all
// look like an org. The lookup tries the public job-board APIs first (Greenhouse, Lever, Ashby,
// SmartRecruiters, Workable: keyless, structured, current) and otherwise runs a web agent that finds
// the company's careers page and reads it; every role link is re-checked before it's returned.

/** What the lookup needs of an org: a name, and a domain when one is known. */
export type OrgRef = Pick<IpOrg, 'name' | 'domain'>;

export type CompanyRole = { title: string; location: string | null; url: string };

export type CompanyRoles = {
	/** Display name for the prompt (the job board's own name when it has one). */
	company: string;
	roles: CompanyRole[];
	source: Source;
};

const REQUEST_TIMEOUT_MS = 2500;
const OVERALL_TIMEOUT_MS = 3000;
// The page-reading agent: 20s when it runs in the background, 40s when a caller waits for it (the
// opener and find_open_roles). Board discovery is one quick search call.
const WEB_TIMEOUT_MS = 20_000;
const WEB_WAIT_TIMEOUT_MS = 40_000;
const DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_ROLES = 5;
const MAX_SLUGS = 4;
const HIT_TTL_MS = 12 * 60 * 60_000;
// A miss is cached for less: the background web search usually replaces it within seconds, and a
// company may start using a job board.
const MISS_TTL_MS = 60 * 60_000;
const CACHE_MAX = 200;

// Design roles, not "Design Engineer" or "Physical Design Verification".
const DESIGN_TITLE =
	/\b(product design|designer|ux|ui\/ux|user experience|interaction design|visual design|brand design|design system|design research|ux research|content design|design manager|design director|head of design|design lead|design program)/i;
const NOT_DESIGN =
	/\b(engineer|writer|copywriter|writing|verification|physical design|electrical|manufacturing|silicon|asic|circuit|civil|architect(?!ure)|interior|fashion|graphic production)\b/i;

/** A title that names some other job, so a page showing it is not the design posting we were told about. */
const OTHER_JOB =
	/\b(engineer|developer|manager|analyst|scientist|recruiter|accountant|counsel|attorney|sales|marketing|specialist|administrator|technician|coordinator|writer|director|architect|associate|intern|consultant|operations|support)\b/i;

export function isDesignRole(title: string): boolean {
	return DESIGN_TITLE.test(title) && !NOT_DESIGN.test(title);
}

type Source = 'ats' | 'web' | 'cache' | 'none';
// Where a hit came from: a job-board API (ats) or the web agent (web).
const AUTHORITATIVE = new Set<Source>(['ats']);
type Stored = {
	company: string;
	roles: CompanyRole[];
	source: Exclude<Source, 'cache'>;
	/** The web agent already ran for this company (and found nothing), so waiting for it again is pointless. */
	webTried?: boolean;
};

/**
 * Role text comes from third-party job boards and a web agent, and ends up in the system prompt and
 * in chips: one line, capped, https links only. Applied where roles enter the module.
 */
export function sanitizeRoles(roles: CompanyRole[]): CompanyRole[] {
	return roles.flatMap((r) => {
		const title = oneLine(r.title, 80);
		let url: string;
		try {
			const u = new URL(r.url);
			if (u.protocol !== 'https:' || u.toString().length > 300) return [];
			url = u.toString();
		} catch {
			return [];
		}
		return title
			? [{ title, location: r.location ? oneLine(r.location, 60) || null : null, url }]
			: [];
	});
}
const cache = new Map<string, { expires: number; value: Stored }>();

function remember(key: string, value: Stored) {
	const ttl = value.roles.length || AUTHORITATIVE.has(value.source) ? HIT_TTL_MS : MISS_TTL_MS;
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(key, { expires: Date.now() + ttl, value });
}

/**
 * A rough fit score of a design role for Hunter (a product designer, hardware + software, design
 * systems and research-minded): higher is a better match. Cheap title heuristics, not a judgment
 * of the posting; the visitor picks, this only orders and decides whether one role stands out.
 */
export function scoreRoleForHunter(title: string): number {
	const t = title.toLowerCase();
	let score = 0;
	if (/product design/.test(t)) score += 4;
	else if (/\b(ux|ui\/ux|user experience|interaction)\b/.test(t)) score += 3;
	else if (/design system/.test(t)) score += 3;
	else if (/\bdesigner\b/.test(t)) score += 2;
	if (/\b(senior|sr\.?|staff|lead|principal)\b/.test(t)) score += 1;
	if (/\b(intern|internship|junior|associate|apprentice)\b/.test(t)) score -= 3;
	if (
		/\b(motion|brand|graphic|character|creative|visual|content|writer|writing|illustrat[a-z]*|3d|environment|game|packaging|marketing)\b/.test(
			t
		)
	)
		score -= 2;
	if (/\b(manager|director|head of|vp|program)\b/.test(t)) score -= 2;
	if (/\b(research|researcher)\b/.test(t)) score -= 1;
	return score;
}

/** Roles best-fit first (stable for ties). */
export function rankRolesForHunter(roles: CompanyRole[]): CompanyRole[] {
	return roles
		.map((role, i) => ({ role, i, score: scoreRoleForHunter(role.title) }))
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map((x) => x.role);
}

/** Board-slug guesses for an org, most likely first: the domain's name, then the company name. */
export function slugCandidates(org: OrgRef): string[] {
	const out: string[] = [];
	const add = (s: string) => {
		const slug = s.toLowerCase().replace(/[^a-z0-9-]/g, '');
		if (slug.length >= 3 && !out.includes(slug)) out.push(slug);
	};
	if (org.domain) {
		const labels = org.domain
			.toLowerCase()
			.replace(/^www\./, '')
			.split('.');
		// acme.com -> acme; acme.co.uk -> acme
		add(labels[0]);
	}
	const words = coreOrgName(org.name).toLowerCase().split(' ').filter(Boolean);
	if (words[0]) add(words[0]);
	if (words.length > 1) {
		add(words.join(''));
		add(words.join('-'));
	}
	return out.slice(0, MAX_SLUGS);
}

async function getJson(url: string): Promise<unknown | null> {
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json', 'User-Agent': 'huntbot' },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

type Board = { company: string | null; jobs: CompanyRole[] };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function greenhouse(slug: string): Promise<Board | null> {
	const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)) as {
		jobs?: {
			title?: string;
			absolute_url?: string;
			company_name?: string;
			location?: { name?: string };
		}[];
	} | null;
	if (!Array.isArray(data?.jobs)) return null;
	return {
		company: str(data.jobs[0]?.company_name),
		jobs: data.jobs.flatMap((j) =>
			str(j.title) && str(j.absolute_url)
				? [{ title: str(j.title)!, location: str(j.location?.name), url: str(j.absolute_url)! }]
				: []
		)
	};
}

async function lever(slug: string, eu = false): Promise<Board | null> {
	const data = (await getJson(
		`https://api.${eu ? 'eu.' : ''}lever.co/v0/postings/${slug}?mode=json`
	)) as { text?: string; hostedUrl?: string; categories?: { location?: string } }[] | null;
	if (!Array.isArray(data)) return null;
	return {
		company: null,
		jobs: data.flatMap((j) =>
			str(j.text) && str(j.hostedUrl)
				? [{ title: str(j.text)!, location: str(j.categories?.location), url: str(j.hostedUrl)! }]
				: []
		)
	};
}

async function ashby(slug: string): Promise<Board | null> {
	const data = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`)) as {
		jobs?: { title?: string; jobUrl?: string; location?: string; isListed?: boolean }[];
	} | null;
	if (!Array.isArray(data?.jobs)) return null;
	return {
		company: null,
		jobs: data.jobs.flatMap((j) =>
			j.isListed !== false && str(j.title) && str(j.jobUrl)
				? [{ title: str(j.title)!, location: str(j.location), url: str(j.jobUrl)! }]
				: []
		)
	};
}

/** "SPOTIFY AB" / "OpenAI, L.L.C." -> "Spotify" / "OpenAI": legal suffixes off, shouting off. */
export function displayName(orgName: string): string {
	const words = coreOrgName(orgName)
		.split(' ')
		.filter((w) => !/^(ab|bv|nv|oy|kk|srl|spa|pty|pte|holdings|group)$/i.test(w));
	// "L.L.C." comes through as "L L C"
	while (words.length > 1 && words[words.length - 1].length === 1) words.pop();
	const name = words.join(' ');
	if (name === name.toUpperCase()) return name.charAt(0) + name.slice(1).toLowerCase();
	// "google" typed in /simulate: capitalise each word
	if (name === name.toLowerCase()) return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
	return name;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Greenhouse boards name their company, so a guessed slug that belongs to someone else
 * ("square" vs a different Square) can be caught. Other boards have no name to compare.
 */
function plausibleBoard(board: Board, org: OrgRef, slug: string): boolean {
	if (!board.company) return true;
	const company = normalize(board.company);
	const wanted = [slug, normalize(coreOrgName(org.name).split(' ')[0] ?? '')].filter(
		(w) => w.length >= 3
	);
	return wanted.some((w) => company.includes(w) || w.includes(company));
}

async function smartrecruiters(slug: string): Promise<Board | null> {
	const data = (await getJson(
		`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`
	)) as {
		totalFound?: number;
		content?: {
			id?: string;
			name?: string;
			company?: { name?: string };
			location?: { city?: string; country?: string };
		}[];
	} | null;
	// Unknown companies answer 200 with an empty list
	if (!Array.isArray(data?.content) || !data.content.length) return null;
	return {
		company: str(data.content[0]?.company?.name),
		jobs: data.content.flatMap((j) =>
			str(j.name) && str(j.id)
				? [
						{
							title: str(j.name)!,
							location:
								[str(j.location?.city), str(j.location?.country)?.toUpperCase()]
									.filter(Boolean)
									.join(', ') || null,
							url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`
						}
					]
				: []
		)
	};
}

async function workable(slug: string): Promise<Board | null> {
	const data = (await getJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`)) as {
		name?: string;
		jobs?: { title?: string; url?: string; city?: string; country?: string }[];
	} | null;
	if (!Array.isArray(data?.jobs)) return null;
	return {
		company: str(data.name),
		jobs: data.jobs.flatMap((j) =>
			str(j.title) && str(j.url)
				? [
						{
							title: str(j.title)!,
							location: [str(j.city), str(j.country)].filter(Boolean).join(', ') || null,
							url: str(j.url)!
						}
					]
				: []
		)
	};
}

async function fromBoards(org: OrgRef): Promise<{ company: string; roles: CompanyRole[] } | null> {
	const slugs = slugCandidates(org);
	const attempts = slugs.flatMap((slug) =>
		[greenhouse, lever, ashby, smartrecruiters, workable].map(async (lookup) => {
			const board = await lookup(slug);
			return board && plausibleBoard(board, org, slug) ? { board, slug } : null;
		})
	);
	// Slug order is likeliness order, so take the first hit in that order rather than the fastest.
	const settled = await Promise.all(attempts);
	const hits = settled.flatMap((r) => (r ? [r] : []));
	if (!hits.length) return null;
	// A board with design roles beats an earlier one that has none (a guessed slug can be someone else's)
	const withRoles = hits
		.map((h) => ({
			h,
			roles: h.board.jobs.filter((j) => isDesignRole(j.title)).slice(0, MAX_ROLES)
		}))
		.find((x) => x.roles.length);
	const pick = withRoles ?? { h: hits[0], roles: [] as CompanyRole[] };
	return {
		company: pick.h.board.company ?? displayName(org.name) ?? pick.h.slug,
		roles: pick.roles
	};
}

const ATS_HOSTS =
	/(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|bamboohr\.com|jobvite\.com|icims\.com|rippling\.com|oraclecloud\.com)$/;

/** The name part of a hostname's registrable domain: careers.uber.com -> uber, shop.acme.co.uk -> acme. */
export function registrableLabel(hostname: string): string {
	const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
	if (labels.length < 2) return labels[0] ?? '';
	// Two-part public suffixes like co.uk / com.au
	const twoPart =
		labels.length >= 3 &&
		labels[labels.length - 1].length === 2 &&
		/^(co|com|org|net|ac|gov|edu)$/.test(labels[labels.length - 2]);
	return labels[labels.length - (twoPart ? 3 : 2)];
}

/**
 * A model-supplied role link is only trusted when it's https on a known job board or the company's
 * own site: its domain when we know it, otherwise a host whose label is or contains the company's
 * name (careers.uber.com for "Uber", metacareers.com for "Meta").
 */
export function isTrustedRoleUrl(
	url: string,
	org: OrgRef,
	{ loose = true }: { loose?: boolean } = {}
): boolean {
	try {
		const u = new URL(url);
		if (u.protocol !== 'https:') return false;
		if (ATS_HOSTS.test(u.hostname)) return true;
		const domain = org.domain?.toLowerCase().replace(/^www\./, '');
		if (domain) return u.hostname === domain || u.hostname.endsWith(`.${domain}`);
		// The label is the name (careers.uber.com) or contains it (metacareers.com for Meta, 4+ letters)
		const label = registrableLabel(u.hostname);
		return slugCandidates(org).some(
			(slug) => label === slug || (loose && slug.length >= 4 && label.includes(slug))
		);
	} catch {
		return false;
	}
}

const webRolesSchema = z.object({
	roles: z
		.array(z.object({ title: z.string(), location: z.string().nullable(), url: z.string() }))
		.max(MAX_ROLES)
});

const htmlToText = compile({
	wordwrap: false,
	selectors: [
		{ selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
		{ selector: 'img', format: 'skip' }
	]
});
const MAX_PAGE_CHARS = 8000;
const MAX_AGENT_STEPS = 6;

const DEAD_POSTING =
	/(no longer (available|accepting)|position (has been|is) (filled|closed)|job (not found|has expired|is closed)|page not found|this (job|position) (is|has been) (closed|removed|filled))/i;

/** Text a visitor would see: scripts, styles and tags removed (big career sites inline megabytes of JS). */
const visibleText = (html: string) =>
	html
		.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.slice(0, 60000);

/**
 * Drops a role only on positive evidence that it's gone (the link 404s/410s or the page says the
 * posting is closed). A page that can't be read (too big, JavaScript-only, a bot wall) keeps the
 * role: the link is already on the company's own domain or a known board, and dropping every
 * role we can't verify made big career sites like Google's always come back empty.
 */
async function stillOpen(role: CompanyRole, requireTitle = false): Promise<boolean> {
	const page = await safeFetchText(role.url, { truncate: true }).catch(() => null);
	if (!page) return !requireTitle;
	if (!page.ok) return !requireTitle && page.status !== 404 && page.status !== 410;
	// A link trusted only loosely (its host merely contains the name: metacareers.com, but also
	// evilmeta.example) has to prove itself with a design title on the page. Otherwise the page
	// is dropped only when its og:title names a different job: a generic title ("Acme") is no evidence.
	const title = pageTitle(page.text);
	if (
		requireTitle
			? !title || !isDesignRole(title)
			: title && OTHER_JOB.test(title) && !isDesignRole(title)
	)
		return false;
	return !DEAD_POSTING.test(visibleText(page.text));
}

/** The posting's own title (og:title), when the page has one that isn't just the site name. */
export function pageTitle(html: string): string | null {
	const og =
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{3,200})["']/i.exec(html) ??
		/<meta[^>]+content=["']([^"']{3,200})["'][^>]+property=["']og:title["']/i.exec(html);
	const title = og?.[1]?.trim();
	if (!title || /^(careers|jobs)\b|\bcareers$/i.test(title)) return null;
	return title.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'");
}

// --- JavaScript rendering (Firecrawl) -------------------------------------------------------------
//
// Some career sites (Meta, Uber...) render their job lists with JavaScript and have no public API,
// so a plain fetch sees an empty shell. Firecrawl loads the page in a real browser and returns its
// text with links. It's the catch-all for any site, used only when a plain fetch comes back empty
// or a discovered careers / search page needs reading. Optional: without FIRECRAWL_API_KEY the
// layer is simply off. Free tier ~1,000 credits a month (1 credit per scrape), so calls are capped
// per warm instance and every result is cached by the company-level cache.

const FIRECRAWL_TIMEOUT_MS = 20_000;
const FIRECRAWL_PER_HOUR = 40;
let firecrawlCalls: number[] = [];

function firecrawlAllowed(): boolean {
	if (!env.FIRECRAWL_API_KEY) {
		warnOnce(
			'firecrawl-off',
			'[HuntBot tools] Firecrawl is off (FIRECRAWL_API_KEY unset): JavaScript-only career sites stay unreadable'
		);
		return false;
	}
	const now = Date.now();
	firecrawlCalls = firecrawlCalls.filter((t) => now - t < 3600_000);
	if (firecrawlCalls.length >= FIRECRAWL_PER_HOUR) return false;
	firecrawlCalls.push(now);
	return true;
}

/** The page as rendered in a browser: markdown with links, or null. Never throws. */
export async function renderPage(
	url: string
): Promise<{ markdown: string; title: string | null } | null> {
	if (!firecrawlAllowed()) return null;
	// Same rule as everything we fetch for a visitor: https only, and a public host.
	const target = await resolvePublicHost(url);
	if ('reason' in target) return null;
	try {
		const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`
			},
			body: JSON.stringify({
				url: target.url.toString(),
				formats: ['markdown'],
				onlyMainContent: false,
				waitFor: 2500,
				timeout: FIRECRAWL_TIMEOUT_MS
			}),
			signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS + 3000)
		});
		if (!res.ok) {
			console.warn('[HuntBot tools] Firecrawl request failed', { status: res.status });
			return null;
		}
		const data = (await res.json()) as {
			success?: boolean;
			data?: { markdown?: string; metadata?: { title?: string | string[] } };
		};
		const markdown = data.data?.markdown ?? '';
		const t = data.data?.metadata?.title;
		return markdown ? { markdown, title: (Array.isArray(t) ? t[0] : t) ?? null } : null;
	} catch (error) {
		console.warn('[HuntBot tools] Firecrawl request failed', { error: describeError(error) });
		return null;
	}
}

/** Plain fetch first (free, fast); a page with almost no text is rendered in a browser instead. */
async function readPage(url: string, { render = true } = {}): Promise<string | null> {
	const page = await safeFetchText(url, { truncate: true });
	const isHtml = page.ok && /html/i.test(page.contentType);
	const text = page.ok ? (isHtml ? htmlToText(page.text) : page.text) : '';
	if (text.trim().length >= 600) return text;
	// Credits are scarce: render only an empty JavaScript shell (HTML with scripts and no text) or a
	// bot wall (401/403/406/429), not a short real page, JSON, or a 404.
	const shell = isHtml && /<script\b/i.test((page as { text: string }).text);
	const botWall = !page.ok && [401, 403, 406, 429].includes(page.status ?? 0);
	if (render && (shell || botWall)) {
		const rendered = await renderPage(url);
		if (rendered) return rendered.markdown;
	}
	return page.ok ? text : null;
}

/**
 * Careers and job-search pages found by discovery, rendered in a browser: every link whose text
 * reads as a design role and that lands on a trusted host is a candidate, and each candidate's own
 * posting page is checked afterwards (see stillOpen). Generic: no site-specific selectors.
 */
async function fromRenderedPages(urls: string[], org: OrgRef): Promise<CompanyRole[]> {
	const pages = await Promise.all(urls.slice(0, 3).map((u) => renderPage(u).catch(() => null)));
	const found = new Map<string, CompanyRole>();
	for (const page of pages) {
		if (!page) continue;
		for (const m of page.markdown.matchAll(/\[([^\]]{4,400})\]\((https:\/\/[^)\s]+)\)/g)) {
			// Cards render as "[**Title**\\\n\\\nCity\\\n\\\nTeam](url)": the title is the first non-empty line
			const title =
				m[1]
					.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
					.split('\n')
					.map((l) => l.replace(/[*\\]/g, '').trim())
					.find(Boolean) ?? '';
			if (!isDesignRole(title) || !isTrustedRoleUrl(m[2], org) || found.has(m[2])) continue;
			found.set(m[2], { title, location: null, url: m[2] });
		}
	}
	const candidates = [...found.values()].slice(0, 12);
	const open = await Promise.all(
		candidates.map((r) => stillOpen(r, !isTrustedRoleUrl(r.url, org, { loose: false })))
	);
	return sanitizeRoles(candidates.filter((_, i) => open[i])).slice(0, MAX_ROLES);
}

/**
 * Roles from what a web search *cites*, not from what the model writes: the search's source URLs
 * on trusted hosts are opened, and the posting page's own title (og:title, which JavaScript-only
 * career sites like Meta's still render server-side) decides whether it's a design role. So the
 * answer doesn't depend on the model's willingness to return a list. Never throws.
 */
async function fromSearchSources(
	org: OrgRef,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<CompanyRole[]> {
	const name = coreOrgName(org.name);
	try {
		const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
		const result = await generateText({
			model: openai.responses('gpt-6-luna'),
			tools: { web_search: openai.tools.webSearch({ searchContextSize: 'medium' }) },
			reasoning: 'low',
			abortSignal: signal
				? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
				: AbortSignal.timeout(timeoutMs),
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Search the web for current open product designer, UX designer, interaction designer and design systems job postings at ${name}${org.domain ? ` (${org.domain})` : ''}, on the company's own careers site or job platform (try a few queries, e.g. "${name} product designer careers", "${name} UX designer job"). List the postings you find, each with its title and link, citing each source.`
		});
		const urls = [
			...new Set(
				result.sources.flatMap((src) =>
					src.sourceType === 'url' && isTrustedRoleUrl(src.url, org) ? [src.url] : []
				)
			)
		].slice(0, 12);
		const pages = await Promise.all(
			urls.map(async (url) => {
				const page = await safeFetchText(url, { truncate: true }).catch(() => null);
				if (!page || !page.ok) return null;
				const title = pageTitle(page.text);
				return title && isDesignRole(title) && !DEAD_POSTING.test(visibleText(page.text))
					? { title, location: null, url }
					: null;
			})
		);
		const roles = sanitizeRoles(pages.flatMap((r) => (r ? [r] : []))).slice(0, MAX_ROLES);
		// Counts only: which step lost the candidates.
		console.log('[HuntBot tools] company roles sources', {
			company: displayName(org.name),
			cited: result.sources.length,
			trusted: urls.length,
			design_titled: roles.length
		});
		return roles;
	} catch (error) {
		console.warn('[HuntBot tools] company roles sources failed', {
			company: displayName(org.name),
			error: describeError(error)
		});
		return [];
	}
}

/**
 * The general path for any company: a short agent loop that searches the web for the company's
 * careers page, opens pages (SSRF-guarded) and follows links to its design roles, then the server
 * re-fetches every returned link and drops dead or untrusted ones, so a role the model made up
 * can't reach a visitor. Slower than the job-board APIs (several model steps), so it only runs
 * when those find nothing, and the result is cached. Never throws.
 */
async function fromWebSearch(
	org: OrgRef,
	timeoutMs = WEB_TIMEOUT_MS,
	signal?: AbortSignal
): Promise<CompanyRole[]> {
	try {
		const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
		const { output } = await generateText({
			model: openai.responses('gpt-6-luna'),
			tools: {
				web_search: openai.tools.webSearch({ searchContextSize: 'low' }),
				fetch_page: tool({
					description:
						"Open a public https page and read its text, with links shown as 'text [url]'. Use it to read a careers page or job listing, and to follow links (a Design team page, a job search with a design filter) that a search result points to.",
					inputSchema: z.object({ url: z.string().describe('The full https URL.') }),
					execute: async ({ url }) => {
						const text = await readPage(url);
						if (text === null) return 'Could not open that page.';
						return text.slice(0, MAX_PAGE_CHARS) || 'The page had no readable text.';
					}
				})
			},
			stopWhen: ({ steps }) => steps.length >= MAX_AGENT_STEPS,
			output: Output.object({ schema: zodSchema(webRolesSchema) }),
			reasoning: 'low',
			abortSignal: signal
				? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
				: AbortSignal.timeout(timeoutMs),
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Find up to ${MAX_ROLES} currently open product design, UX, visual or design-systems roles at ${coreOrgName(org.name)}${org.domain ? ` (${org.domain})` : ''}. Search for the company's own careers page or job board, open it, and look for design roles (try a design filter, a Design team page, or a job search for "product designer" / "UX designer" if the site has one; many big career sites need JavaScript and show nothing when opened, so also search for its postings directly, e.g. "<company> product designer job", and use the results). Only include roles you saw on a page or in search results, each with the direct link to that posting on the company's careers site or job board (not an aggregator like LinkedIn or Indeed); each link is checked afterwards. If you can't open the careers page (many are JavaScript-only), that is expected: use search results instead, and always return the best matches you found, because every link is checked after you answer. Return an empty list only when the searches show no design postings at all. Never invent a role or fill one in from memory.`
		});
		const candidates = output.roles.filter(
			(r) => isDesignRole(r.title) && isTrustedRoleUrl(r.url, org)
		);
		const open = await Promise.all(
			candidates.map((r) => stillOpen(r, !isTrustedRoleUrl(r.url, org, { loose: false })))
		);
		const kept = candidates.filter((_, i) => open[i]);
		// Counts only: tells an empty answer from the model apart from links the checks dropped.
		console.log('[HuntBot tools] company roles web', {
			company: displayName(org.name),
			returned: output.roles.length,
			design_and_trusted: candidates.length,
			still_open: kept.length
		});
		return sanitizeRoles(kept);
	} catch (error) {
		console.warn('[HuntBot tools] company roles web search failed', {
			company: displayName(org.name),
			error: describeError(error)
		});
		return [];
	}
}

// --- Board discovery: find where a company posts its jobs, then read the platform's own API ---
//
// Big companies mostly run a hosted job platform under their own careers site (Adobe on Workday,
// Netflix on Eightfold, many on Greenhouse/Lever/Ashby with a slug we can't guess). One quick web
// search finds those URLs; a platform adapter then reads the full, current list from that
// platform's public JSON API. No per-company code: the adapters key on URL patterns.

const discoverySchema = z.object({
	careers_url: z.string().nullable().describe("The company's own careers / job search page."),
	job_search_url: z
		.string()
		.nullable()
		.describe(
			'A job search results page on its careers site already filtered for "product designer" (the query in the URL), if the site has one.'
		),
	board_urls: z
		.array(z.string())
		.max(5)
		.describe(
			'URLs of its hosted job boards or job search, e.g. https://acme.wd5.myworkdayjobs.com/External, https://boards.greenhouse.io/acme, https://jobs.lever.co/acme.'
		),
	job_posting_urls: z
		.array(z.string())
		.max(3)
		.describe(
			'Up to 3 URLs of individual open design or product jobs at the company on that platform, as seen in search results. They reveal the platform board (a Workday site name can only be read from a posting URL).'
		),
	domain: z.string().nullable().describe("The company's main web domain, e.g. acme.com.")
});
type Discovery = z.infer<typeof discoverySchema>;

async function discoverBoards(org: OrgRef): Promise<Discovery | null> {
	const storeKey = key(org);
	const stored = await getRecord('board', storeKey);
	// (records from before `job_posting_urls` existed are re-discovered)
	if (stored && Array.isArray(stored.board_urls) && Array.isArray(stored.job_posting_urls)) {
		return stored as unknown as Discovery;
	}
	if (!env.OPENAI_API_KEY) return null;
	try {
		const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
		const { output } = await generateText({
			model: openai.responses('gpt-6-luna'),
			tools: { web_search: openai.tools.webSearch({ searchContextSize: 'low' }) },
			output: Output.object({ schema: zodSchema(discoverySchema) }),
			reasoning: 'low',
			abortSignal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Where does ${coreOrgName(org.name)}${org.domain ? ` (${org.domain})` : ''} list its open jobs? Give its careers page and the URLs of the job platform it uses for listings if any (Workday myworkdayjobs.com, Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Eightfold or similar), as seen in search results. Also give a job search results URL filtered for product designer if the careers site has one. Also give up to 3 URLs of individual open design or product job postings on that platform exactly as they appear in search results, because they reveal its board name. Don't list job aggregators (LinkedIn, Indeed, Glassdoor). Use null / an empty list when you can't find them; never guess a URL.`
		});
		// Kept only once something read from it (see fromDiscoveredBoards), so a search that found
		// the wrong platform isn't remembered for a month.
		return output;
	} catch (error) {
		console.warn('[HuntBot tools] company roles board discovery failed', {
			company: displayName(org.name),
			error: describeError(error)
		});
		return null;
	}
}

const WORKDAY_CLUSTERS = [1, 3, 5, 12, 103, 501];

async function workdaySearch(host: string, tenant: string, site: string): Promise<Board | null> {
	try {
		const res = await fetch(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'designer' }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2)
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			jobPostings?: { title?: string; externalPath?: string; locationsText?: string }[];
		};
		if (!Array.isArray(data.jobPostings)) return null;
		return {
			company: null,
			jobs: data.jobPostings.flatMap((j) =>
				str(j.title) && str(j.externalPath)
					? [
							{
								title: str(j.title)!,
								location: str(j.locationsText),
								url: `https://${host}/${site}${j.externalPath}`
							}
						]
					: []
			)
		};
	} catch {
		return null;
	}
}

const firstBoard = async (attempts: Promise<Board | null>[]) =>
	(await Promise.all(attempts)).find((b) => b !== null) ?? null;

/**
 * Workday's public job search (CXS), from a `<tenant>.<wdN>.myworkdayjobs.com[/<site>]` URL.
 * A search can name the wrong cluster (wd1 for wd12) or only the tenant, so a miss on the given
 * host/site tries the other clusters, and a missing site tries the usual names.
 */
async function workday(url: URL): Promise<Board | null> {
	const m = /^([a-z0-9-]+)\.wd(\d+)\.myworkdayjobs\.com$/i.exec(url.hostname);
	if (!m) return null;
	const [, tenant, cluster] = m;
	const site = url.pathname
		.split('/')
		.filter(Boolean)
		.find((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p) && !/^(job|details|login)$/i.test(p));
	const hostFor = (n: number | string) => `${tenant}.wd${n}.myworkdayjobs.com`;
	if (site && /^[\w-]+$/.test(site)) {
		const exact = await workdaySearch(url.hostname, tenant, site);
		if (exact) return exact;
		return firstBoard(
			WORKDAY_CLUSTERS.filter((n) => String(n) !== cluster).map((n) =>
				workdaySearch(hostFor(n), tenant, site)
			)
		);
	}
	const t = tenant.charAt(0).toUpperCase() + tenant.slice(1);
	const sites = [
		'External',
		'external',
		'Careers',
		'careers',
		'External_Career_Site',
		t,
		`${t}_Careers`,
		`${t}_External`,
		`${t}Careers`
	];
	return firstBoard(sites.map((sName) => workdaySearch(url.hostname, tenant, sName)));
}

/** Eightfold's public job search (`/api/apply/v2/jobs`), tried on a careers host when nothing else matched. */
async function eightfold(url: URL, domain: string | null): Promise<Board | null> {
	if (!domain) return null;
	const data = (await getJson(
		`https://${url.hostname}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&query=designer&num=40`
	)) as {
		positions?: { name?: string; location?: string; canonicalPositionUrl?: string }[];
	} | null;
	if (!Array.isArray(data?.positions)) return null;
	return {
		company: null,
		jobs: data.positions.flatMap((j) =>
			str(j.name) && str(j.canonicalPositionUrl)
				? [{ title: str(j.name)!, location: str(j.location), url: str(j.canonicalPositionUrl)! }]
				: []
		)
	};
}

const ORACLE_BOARD =
	/https:\/\/([a-z0-9-]+\.fa\.[a-z0-9.-]*oraclecloud\.com)\/hcmUI\/CandidateExperience\/[A-Za-z-]+\/sites\/([\w-]+)/i;

/**
 * Oracle Hiring (Oracle Recruiting Cloud) public job search, used by Uber and many large
 * companies. A URL on `<pod>.fa.<region>.oraclecloud.com/.../sites/<Site>` names the board; a
 * custom careers domain is read once for a link to one (plain fetch, Firecrawl if that is empty).
 */
async function oracle(url: URL, render: boolean): Promise<Board | null> {
	let m = ORACLE_BOARD.exec(url.href);
	if (!m && !url.hostname.endsWith('oraclecloud.com')) {
		const page = await readPage(url.href, { render });
		m = page ? ORACLE_BOARD.exec(page) : null;
	}
	if (!m) return null;
	const [, host, site] = m;
	const data = (await getJson(
		`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(
			`findReqs;siteNumber=${site},keyword="designer",limit=40`
		)}`
	)) as {
		items?: {
			requisitionList?: { Id?: string; Title?: string; PrimaryLocation?: string }[];
		}[];
	} | null;
	const list = data?.items?.[0]?.requisitionList;
	if (!Array.isArray(list)) return null;
	return {
		company: null,
		jobs: list.flatMap((j) =>
			str(j.Id) && str(j.Title)
				? [
						{
							title: str(j.Title)!,
							location: str(j.PrimaryLocation),
							url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`
						}
					]
				: []
		)
	};
}

/** The adapter a board URL calls for, with the board slug taken from the URL instead of guessed. Exported for tests. */
export async function fromBoardUrl(
	raw: string,
	domain: string | null,
	render = false
): Promise<{ board: Board; via: string } | null> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	const host = url.hostname.toLowerCase();
	const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
	const slugOk = /^[\w-]{2,60}$/.test(first);
	const via = (name: string, board: Board | null) => (board ? { board, via: name } : null);
	if (host.endsWith('.myworkdayjobs.com')) return via('workday', await workday(url));
	if (/(^|\.)greenhouse\.io$/.test(host)) {
		// Embeds are boards.greenhouse.io/embed/job_board?for=<slug>
		const slug = first === 'embed' ? url.searchParams.get('for') : first;
		return slug && /^[\w-]{2,60}$/.test(slug) ? via('greenhouse', await greenhouse(slug)) : null;
	}
	if (/(^|\.)lever\.co$/.test(host) && slugOk)
		return via('lever', await lever(first, host.includes('.eu.')));
	if (host === 'jobs.ashbyhq.com' && slugOk) return via('ashby', await ashby(first));
	if (host === 'jobs.smartrecruiters.com' && slugOk)
		return via('smartrecruiters', await smartrecruiters(first));
	if (host === 'apply.workable.com' && slugOk) return via('workable', await workable(first));
	// Anything else is a host a search result named: only public hosts, never an internal address.
	if ('reason' in (await resolvePublicHost(url.href))) return null;
	return via('eightfold', await eightfold(url, domain)) ?? via('oracle', await oracle(url, render));
}

/** Discovery, then the platform adapters. Never throws. */
async function fromDiscoveredBoards(
	org: OrgRef
): Promise<{ roles: CompanyRole[]; via: string } | null> {
	const found = await discoverBoards(org);
	if (!found) return null;
	const hostOf = (u: string) => {
		try {
			return new URL(u).hostname;
		} catch {
			return 'invalid';
		}
	};
	const domain =
		(found.domain ?? org.domain ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '') || null;
	const urls = [
		...found.job_posting_urls,
		...found.board_urls,
		...(found.careers_url ? [found.careers_url] : [])
	].slice(0, 8);
	// Only the careers page itself may be rendered (to find an Oracle board); posting URLs stay plain.
	const boards = await Promise.all(
		urls.map((u) => fromBoardUrl(u, domain, u === found.careers_url).catch(() => null))
	);
	// Hosts and counts only: shows what discovery found and which adapter (if any) could read it.
	console.log('[HuntBot tools] company roles discovery', {
		company: displayName(org.name),
		hosts: urls.map(hostOf),
		adapters: boards.map((b) => (b ? `${b.via}:${b.board.jobs.length}` : null))
	});
	for (const hit of boards) {
		const roles = sanitizeRoles(hit?.board.jobs.filter((j) => isDesignRole(j.title)) ?? []).slice(
			0,
			MAX_ROLES
		);
		if (hit && roles.length) {
			await putRecord('board', key(org), found as unknown as Record<string, unknown>);
			return { roles, via: hit.via };
		}
	}
	// No platform API to read (a company's own JavaScript-rendered site): render its job search /
	// careers pages in a browser and read the design-role links off them.
	const pages = [found.job_search_url, found.careers_url, ...found.board_urls].filter(
		(u): u is string => Boolean(u)
	);
	if (pages.length) {
		const roles = await fromRenderedPages([...new Set(pages)], org).catch(() => []);
		if (roles.length) {
			await putRecord('board', key(org), found as unknown as Record<string, unknown>);
			return { roles, via: 'rendered' };
		}
	}
	return null;
}

/**
 * The slower path for a company whose board slug can't be guessed: discovery + platform API first,
 * then the page-reading agent. Logs which one answered. Never throws.
 */
async function fromWeb(
	org: OrgRef,
	wait: boolean
): Promise<{ roles: CompanyRole[]; source: 'ats' | 'web' }> {
	const t0 = Date.now();
	const timeout = wait ? WEB_WAIT_TIMEOUT_MS : WEB_TIMEOUT_MS;
	// Discovery + platform API and the page-reading agent run side by side (a slow discovery used to
	// eat the agent's time); the platform API's answer wins when it has one.
	// Whichever of them loses is aborted so it stops spending tokens and render credits.
	const abort = new AbortController();
	const agent = fromWebSearch(org, timeout, abort.signal).catch(() => [] as CompanyRole[]);
	// The agent often comes back empty on JavaScript-only career sites, so a second search runs
	// beside it and its cited pages are judged by their own titles (it doesn't depend on a list the
	// model writes); the agent's roles win when it has any.
	const sources = fromSearchSources(org, timeout, abort.signal).catch(() => [] as CompanyRole[]);
	const board = await fromDiscoveredBoards(org).catch(() => null);
	if (board) {
		abort.abort();
		console.log('[HuntBot tools] company roles path', {
			company: displayName(org.name),
			via: `board:${board.via}`,
			roles: board.roles.length,
			ms: Date.now() - t0
		});
		return { roles: board.roles, source: 'ats' };
	}
	let roles = await agent;
	let via = 'agent';
	if (roles.length) abort.abort();
	else {
		roles = await sources;
		via = 'search-sources';
	}
	console.log('[HuntBot tools] company roles path', {
		company: displayName(org.name),
		via: roles.length ? via : 'none',
		roles: roles.length,
		ms: Date.now() - t0
	});
	return { roles, source: 'web' };
}

/**
 * The job-board APIs only. A board that exists but has no design roles isn't an answer (a guessed
 * slug can land on an unrelated or empty board: "apple", "meta"), so that falls through to the
 * web agent rather than claiming there are none.
 */
async function findRoles(org: OrgRef): Promise<Stored | null> {
	const boards = await fromBoards(org).catch(() => null);
	const roles = boards ? sanitizeRoles(boards.roles) : [];
	return boards && roles.length ? { company: boards.company, roles, source: 'ats' } : null;
}

const key = (org: OrgRef) => (org.domain ?? coreOrgName(org.name)).toLowerCase();

/**
 * Open design roles at the org's company. Bounded to ~2.8s and never throws; on a first sighting
 * of a company with no job board it answers "none" now and fills the cache from a background web
 * search for later turns, unless `waitForWeb` (a visitor named the company) says to wait for it. Job boards are public and unauthenticated; nothing about the visitor is sent.
 */
const inFlight = new Map<string, Promise<CompanyRoles>>();

/**
 * Concurrent lookups for the same company share one run (two requests used to start two web
 * agents that could disagree), see `lookupOnce`.
 */
export function lookupCompanyRoles(
	org: OrgRef,
	opts: { waitForWeb?: boolean } = {}
): Promise<CompanyRoles> {
	const k = `${key(org)}|${opts.waitForWeb ? 'wait' : 'bg'}`;
	const running = inFlight.get(k);
	if (running) return running;
	const run = lookupOnce(org, opts).finally(() => inFlight.delete(k));
	inFlight.set(k, run);
	return run;
}

async function lookupOnce(
	org: OrgRef,
	{ waitForWeb = false }: { waitForWeb?: boolean } = {}
): Promise<CompanyRoles> {
	const k = key(org);
	const hit = cache.get(k);
	// A cached miss is served to callers who'd otherwise wait for the web agent only when that
	// agent has already run for this company; otherwise they'd re-run it for every visitor.
	if (
		hit &&
		hit.expires > Date.now() &&
		(hit.value.roles.length ||
			AUTHORITATIVE.has(hit.value.source) ||
			hit.value.webTried ||
			!waitForWeb)
	) {
		return { ...hit.value, source: 'cache' };
	}

	// Never replaces roles already cached (a slow lookup can finish after a faster one).
	const keepBetter = (value: Stored) => {
		const existing = cache.get(k);
		if (
			existing &&
			existing.expires > Date.now() &&
			existing.value.roles.length &&
			!value.roles.length
		) {
			return;
		}
		remember(k, value);
	};

	const none: Stored = { company: displayName(org.name), roles: [], source: 'none' };
	const lookup = findRoles(org);
	let timedOut = false;
	try {
		const found = await Promise.race([
			lookup,
			new Promise<null>((resolve) =>
				setTimeout(() => {
					timedOut = true;
					resolve(null);
				}, OVERALL_TIMEOUT_MS)
			)
		]);
		if (found) {
			remember(k, found);
			return found;
		}
	} catch {
		// fall through to "none"
	}
	if (timedOut) {
		// A slow board still answered: keep its result for the next visitor instead of dropping it,
		// and don't cache a miss for an hour on the strength of a timeout.
		waitUntil(
			lookup
				.then((late) => {
					if (late) keepBetter(late);
				})
				.catch(() => {})
		);
	} else {
		remember(k, none);
	}

	if (env.COMPANY_ROLES_WEB === '0') {
		if (!timedOut) remember(k, { ...none, webTried: true });
		return none;
	}
	if (waitForWeb) {
		// The visitor named the company, or it's the chat-open opener: the web search is worth waiting for.
		const { roles, source } = await fromWeb(org, true);
		if (roles.length) {
			const value = { company: none.company, roles, source };
			keepBetter(value);
			return value;
		}
		if (!timedOut) remember(k, { ...none, webTried: true });
		return none;
	}
	waitUntil(
		fromWeb(org, false).then(({ roles, source }) => {
			if (roles.length) keepBetter({ company: none.company, roles, source });
			else if (!timedOut) keepBetter({ ...none, webTried: true });
		})
	);
	return none;
}
