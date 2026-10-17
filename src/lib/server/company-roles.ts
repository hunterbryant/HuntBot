import { env } from '$env/dynamic/private';
import { coreOrgName, type IpOrg } from '$lib/server/ip-org';
import { safeFetchText } from '$lib/server/safe-fetch';
import { describeError } from '$lib/server/tool-log';
import { createOpenAI } from '@ai-sdk/openai';
import { waitUntil } from '@vercel/functions';
import { generateText, Output, zodSchema } from 'ai';
import { z } from 'zod';

// Open design roles at the company a visitor's network belongs to, so HuntBot can ask "are you
// hiring for the Maps designer role?" instead of guessing blind. The network owner comes from the
// IPinfo lookup (ip-org.ts) and is only a guess: VPNs, coworking spaces and parent companies all
// look like an org. The lookup tries the public job-board APIs (Greenhouse, Lever, Ashby: keyless,
// structured, current) and only falls back to a web search when no board is found, in the
// background, so a slow search never delays a reply.

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
const OVERALL_TIMEOUT_MS = 5000;
const WEB_TIMEOUT_MS = 8000;
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
	/\b(engineer|engineering|verification|physical design|hardware|mechanical|electrical|manufacturing|silicon|asic|circuit|civil|architect(?!ure)|interior|fashion|graphic production)\b/i;

export function isDesignRole(title: string): boolean {
	return DESIGN_TITLE.test(title) && !NOT_DESIGN.test(title);
}

type Source = 'ats' | 'site' | 'page' | 'web' | 'cache' | 'none';
// Where a hit came from: a job-board API (ats), one of the big companies' own career sites (site),
// links scraped from the company's careers page (page), or a web search (web).
const AUTHORITATIVE = new Set<Source>(['ats', 'site']);
type Stored = { company: string; roles: CompanyRole[]; source: Exclude<Source, 'cache'> };
const cache = new Map<string, { expires: number; value: Stored }>();

function remember(key: string, value: Stored) {
	const ttl = value.roles.length || AUTHORITATIVE.has(value.source) ? HIT_TTL_MS : MISS_TTL_MS;
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(key, { expires: Date.now() + ttl, value });
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

// Big companies that run their own career sites instead of a shared job board. Each adapter reads
// the site's public search (no key) for design roles; adding one means adding a function here.
const ACRONYMS = new Set(['ux', 'ui', 'ai', 'ml', 'xr', 'vr', 'ar', 'hci', 'cx', 'ii', 'iii']);
const SMALL = new Set(['and', 'of', 'for', 'the', 'to', 'in']);
const titleCase = (slug: string) =>
	slug
		.split('-')
		.map((w, i) =>
			ACRONYMS.has(w)
				? w.toUpperCase()
				: i && SMALL.has(w)
					? w
					: w.charAt(0).toUpperCase() + w.slice(1)
		)
		.join(' ');

async function googleCareers(): Promise<Board | null> {
	const queries = ['product designer', 'ux designer', 'interaction designer'];
	const pages = await Promise.all(
		queries.map(async (q) => {
			try {
				const res = await fetch(
					`https://www.google.com/about/careers/applications/jobs/results/?q=${encodeURIComponent(q)}`,
					{
						headers: { 'User-Agent': 'Mozilla/5.0 (compatible; huntbot)' },
						signal: AbortSignal.timeout(4500)
					}
				);
				return res.ok ? await res.text() : '';
			} catch {
				return '';
			}
		})
	);
	const seen = new Set<string>();
	const jobs: CompanyRole[] = [];
	for (const html of pages) {
		// The listing links carry the title in the slug: jobs/results/<id>-<title-slug>
		for (const m of html.matchAll(/jobs\/results\/(\d+)-([a-z0-9-]+)/g)) {
			if (seen.has(m[1])) continue;
			seen.add(m[1]);
			jobs.push({
				title: titleCase(m[2]),
				location: null,
				url: `https://www.google.com/about/careers/applications/jobs/results/${m[1]}-${m[2]}`
			});
		}
	}
	return jobs.length ? { company: 'Google', jobs } : null;
}

async function amazonJobs(): Promise<Board | null> {
	const data = (await getJson(
		'https://www.amazon.jobs/en/search.json?base_query=product+designer&result_limit=40'
	)) as { jobs?: { title?: string; job_path?: string; normalized_location?: string }[] } | null;
	if (!Array.isArray(data?.jobs)) return null;
	return {
		company: 'Amazon',
		jobs: data.jobs.flatMap((j) =>
			str(j.title) && str(j.job_path)
				? [
						{
							title: str(j.title)!,
							location: str(j.normalized_location),
							url: `https://www.amazon.jobs${j.job_path}`
						}
					]
				: []
		)
	};
}

async function netflixJobs(): Promise<Board | null> {
	const data = (await getJson(
		'https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&query=designer&num=40'
	)) as {
		positions?: { name?: string; location?: string; canonicalPositionUrl?: string }[];
	} | null;
	if (!Array.isArray(data?.positions)) return null;
	return {
		company: 'Netflix',
		jobs: data.positions.flatMap((j) =>
			str(j.name) && str(j.canonicalPositionUrl)
				? [{ title: str(j.name)!, location: str(j.location), url: str(j.canonicalPositionUrl)! }]
				: []
		)
	};
}

const OWN_SITES: { match: RegExp; lookup: () => Promise<Board | null> }[] = [
	{ match: /^(google|alphabet)$/, lookup: googleCareers },
	{ match: /^amazon$/, lookup: amazonJobs },
	{ match: /^netflix$/, lookup: netflixJobs }
];

async function fromOwnSite(org: OrgRef): Promise<Board | null> {
	const slugs = slugCandidates(org);
	const site = OWN_SITES.find((s) => slugs.some((slug) => s.match.test(slug)));
	return site ? site.lookup() : null;
}

/**
 * Last keyless resort for a custom careers site: fetch likely careers URLs on the company's own
 * domain and keep links whose text reads as a design role. Server-rendered pages only.
 */
async function fromCareersPage(org: OrgRef): Promise<Board | null> {
	const domain = (org.domain ?? `${slugCandidates(org)[0] ?? ''}.com`)
		.toLowerCase()
		.replace(/^www\./, '');
	if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
	const candidates = [
		`https://careers.${domain}`,
		`https://jobs.${domain}`,
		`https://${domain}/careers`,
		`https://www.${domain}/careers`
	];
	const pages = await Promise.all(candidates.map((u) => safeFetchText(u).catch(() => null)));
	const jobs: CompanyRole[] = [];
	const seen = new Set<string>();
	for (const page of pages) {
		if (!page || !page.ok) continue;
		for (const m of page.text.matchAll(/\[([^\]\n]{6,120})\]\((https:\/\/[^)\s]+)\)/g)) {
			const title = m[1].trim();
			if (!isDesignRole(title) || seen.has(m[2]) || !isTrustedRoleUrl(m[2], org)) continue;
			seen.add(m[2]);
			jobs.push({ title, location: null, url: m[2] });
		}
	}
	return jobs.length ? { company: displayName(org.name), jobs } : null;
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

/** Web search for design roles, used only when no job board was found. Never throws. */
async function fromWebSearch(org: OrgRef): Promise<CompanyRole[]> {
	try {
		const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
		const { output } = await generateText({
			model: openai.responses('gpt-6-luna'),
			tools: { web_search: openai.tools.webSearch({ searchContextSize: 'low' }) },
			output: Output.object({ schema: zodSchema(webRolesSchema) }),
			reasoning: 'low',
			abortSignal: AbortSignal.timeout(WEB_TIMEOUT_MS),
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Find up to ${MAX_ROLES} currently open product design, UX, visual or design-systems roles at ${coreOrgName(org.name)}${org.domain ? ` (${org.domain})` : ''}, from their own careers page or job board. Only include roles you can see are open now, each with the direct link to the posting. If the company has no open design roles or you can't find its careers page, return an empty list. Do not guess.`
		});
		return output.roles.filter((r) => isDesignRole(r.title) && isTrustedRoleUrl(r.url, org));
	} catch (error) {
		console.warn('[HuntBot tools] company roles web search failed', {
			error: describeError(error)
		});
		return [];
	}
}

/**
 * Job-board APIs and the big companies' own sites in parallel; the careers-page scrape only when
 * those turn up no design roles. A board that exists but has no design roles right now still
 * counts as an answer ("ats", zero roles), so the web search isn't spent on a company we can read.
 */
async function findRoles(org: OrgRef): Promise<Stored | null> {
	const [boards, own] = await Promise.all([
		fromBoards(org).catch(() => null),
		fromOwnSite(org).catch(() => null)
	]);
	const ownRoles = own?.jobs.filter((j) => isDesignRole(j.title)).slice(0, MAX_ROLES) ?? [];
	if (boards?.roles.length) return { company: boards.company, roles: boards.roles, source: 'ats' };
	if (own && ownRoles.length)
		return { company: own.company ?? displayName(org.name), roles: ownRoles, source: 'site' };
	const page = await fromCareersPage(org).catch(() => null);
	if (page) {
		const roles = page.jobs.slice(0, MAX_ROLES);
		if (roles.length)
			return { company: page.company ?? displayName(org.name), roles, source: 'page' };
	}
	// A guessed slug can land on an unrelated or empty board ("apple", "meta"), so a board with no
	// design roles isn't an answer: fall through to the web search rather than claim there are none.
	return null;
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
	// A cached miss is only worth serving when the caller isn't willing to wait for a web search.
	if (
		hit &&
		hit.expires > Date.now() &&
		(hit.value.roles.length || AUTHORITATIVE.has(hit.value.source) || !waitForWeb)
	) {
		return { ...hit.value, source: 'cache' };
	}

	const none: Stored = { company: displayName(org.name), roles: [], source: 'none' };
	try {
		const found = await Promise.race([
			findRoles(org),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), OVERALL_TIMEOUT_MS))
		]);
		if (found) {
			remember(k, found);
			return found;
		}
	} catch {
		// fall through to "none"
	}

	remember(k, none);
	if (env.COMPANY_ROLES_WEB === '0') return none;
	if (waitForWeb) {
		// A visitor asked about this company by name, so the web search is worth waiting for.
		const roles = await fromWebSearch(org);
		if (roles.length) {
			const value = { company: none.company, roles, source: 'web' as const };
			remember(k, value);
			return value;
		}
		return none;
	}
	waitUntil(
		fromWebSearch(org).then((roles) => {
			if (roles.length) remember(k, { company: none.company, roles, source: 'web' });
		})
	);
	return none;
}
