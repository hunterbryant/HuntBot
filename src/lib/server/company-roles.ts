import { env } from '$env/dynamic/private';
import { coreOrgName, type IpOrg } from '$lib/server/ip-org';
import { safeFetchText } from '$lib/server/safe-fetch';
import { describeError } from '$lib/server/tool-log';
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
const WEB_TIMEOUT_MS = 20_000;
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
	/\b(engineer|verification|physical design|electrical|manufacturing|silicon|asic|circuit|civil|architect(?!ure)|interior|fashion|graphic production)\b/i;

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

const oneLine = (t: string, max: number) =>
	t
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);

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

async function lever(slug: string): Promise<Board | null> {
	const data = (await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`)) as
		| { text?: string; hostedUrl?: string; categories?: { location?: string } }[]
		| null;
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
	return name === name.toUpperCase() ? name.charAt(0) + name.slice(1).toLowerCase() : name;
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
	/(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|bamboohr\.com|jobvite\.com|icims\.com|rippling\.com)$/;

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
 * own site: its domain when we know it, otherwise a host with a label that is the company's name
 * (careers.uber.com for "Uber").
 */
export function isTrustedRoleUrl(url: string, org: OrgRef): boolean {
	try {
		const u = new URL(url);
		if (u.protocol !== 'https:') return false;
		if (ATS_HOSTS.test(u.hostname)) return true;
		const domain = org.domain?.toLowerCase().replace(/^www\./, '');
		if (domain) return u.hostname === domain || u.hostname.endsWith(`.${domain}`);
		return slugCandidates(org).includes(registrableLabel(u.hostname));
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
async function stillOpen(role: CompanyRole): Promise<boolean> {
	const page = await safeFetchText(role.url, { truncate: true }).catch(() => null);
	if (!page) return true;
	if (!page.ok) return page.status !== 404 && page.status !== 410;
	return !DEAD_POSTING.test(visibleText(page.text));
}

/**
 * The general path for any company: a short agent loop that searches the web for the company's
 * careers page, opens pages (SSRF-guarded) and follows links to its design roles, then the server
 * re-fetches every returned link and drops dead or untrusted ones, so a role the model made up
 * can't reach a visitor. Slower than the job-board APIs (several model steps), so it only runs
 * when those find nothing, and the result is cached. Never throws.
 */
async function fromWebSearch(org: OrgRef): Promise<CompanyRole[]> {
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
						const page = await safeFetchText(url, { truncate: true });
						if (!page.ok) return `Could not open that page: ${page.reason}`;
						const text = /html/i.test(page.contentType) ? htmlToText(page.text) : page.text;
						return text.slice(0, MAX_PAGE_CHARS) || 'The page had no readable text.';
					}
				})
			},
			stopWhen: ({ steps }) => steps.length >= MAX_AGENT_STEPS,
			output: Output.object({ schema: zodSchema(webRolesSchema) }),
			reasoning: 'low',
			abortSignal: AbortSignal.timeout(WEB_TIMEOUT_MS),
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Find up to ${MAX_ROLES} currently open product design, UX, visual or design-systems roles at ${coreOrgName(org.name)}${org.domain ? ` (${org.domain})` : ''}. Search for the company's own careers page or job board, open it, and look for design roles (try a design filter, a Design team page, or a job search for "product designer" / "UX designer" if the site has one; pages that need JavaScript may show nothing, so also try search results that list its postings). Only include roles you saw on a page, each with the direct link to that posting. If the company has no open design roles or you can't reach its careers page, return an empty list. Never guess or fill in a role from memory.`
		});
		const candidates = output.roles.filter(
			(r) => isDesignRole(r.title) && isTrustedRoleUrl(r.url, org)
		);
		const open = await Promise.all(candidates.map(stillOpen));
		const kept = candidates.filter((_, i) => open[i]);
		// Counts only: tells an empty answer from the model apart from links the checks dropped.
		console.log('[HuntBot tools] company roles web', {
			returned: output.roles.length,
			design_and_trusted: candidates.length,
			still_open: kept.length
		});
		return sanitizeRoles(kept);
	} catch (error) {
		console.warn('[HuntBot tools] company roles web search failed', {
			error: describeError(error)
		});
		return [];
	}
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
export async function lookupCompanyRoles(
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
		const roles = await fromWebSearch(org);
		if (roles.length) {
			const value = { company: none.company, roles, source: 'web' as const };
			keepBetter(value);
			return value;
		}
		if (!timedOut) remember(k, { ...none, webTried: true });
		return none;
	}
	waitUntil(
		fromWebSearch(org).then((roles) => {
			if (roles.length) keepBetter({ company: none.company, roles, source: 'web' });
			else if (!timedOut) keepBetter({ ...none, webTried: true });
		})
	);
	return none;
}
