import { env } from '$env/dynamic/private';
import { coreOrgName, type IpOrg } from '$lib/server/ip-org';
import type { NavPage } from '$lib/server/site-nav-routes';

// Turns the raw request (headers + the browser's self-reported payload) into a small set of
// labels for the system prompt. Nothing here is trusted: the client payload is re-validated, and
// the model only ever sees derived labels, never the IP, user agent or raw URLs.

export type VisitorContext = {
	/** 'campaign:<slug>' | 'linkedin' | 'search' | 'social' | 'referral:<domain>' | 'direct' */
	arrivedVia: string;
	via: string | null;
	device: 'mobile' | 'desktop';
	timezone: string | null;
	localTime: string | null;
	localDateISO: string | null;
	pagesSeen: { title: string; kind: string; seconds: number }[];
	/** English name of the browser language, only when it isn't English */
	language: string | null;
	country: string | null;
	returning: boolean;
	gpc: boolean;
	org: IpOrg | null;
};

const SLUG = /^[a-z0-9-]{1,40}$/;
const DOMAIN = /^[a-z0-9.-]{3,80}$/;
const MAX_PAGES = 10;

export function visitorContextEnabled(): boolean {
	return env.VISITOR_CONTEXT !== '0';
}

function bucketReferrer(domain: string): string {
	if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(domain)) return 'linkedin';
	if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|ecosia\.org|search\.brave\.com|kagi\.com)$/.test(domain))
		return 'search';
	if (
		/(^|\.)(twitter\.com|x\.com|t\.co|facebook\.com|instagram\.com|reddit\.com|threads\.net|bsky\.app|news\.ycombinator\.com|dribbble\.com|behance\.net)$/.test(
			domain
		)
	)
		return 'social';
	return `referral:${domain}`;
}

function validTimeZone(tz: unknown): string | null {
	if (typeof tz !== 'string' || tz.length > 64) return null;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return tz;
	} catch {
		return null;
	}
}

function languageName(header: string | null): string | null {
	const primary = header?.split(',')[0]?.trim().split(';')[0]?.split('-')[0]?.toLowerCase();
	if (!primary || primary === 'en' || !/^[a-z]{2,3}$/.test(primary)) return null;
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(primary) ?? null;
	} catch {
		return null;
	}
}

function pageKind(category: NavPage['category']): string {
	return category === 'case_study' ? 'case study' : category === 'project' ? 'project' : 'page';
}

export function buildVisitorContext(options: {
	request: Request;
	payload: unknown;
	pages: NavPage[];
	currentPage: string;
	org: IpOrg | null;
}): VisitorContext {
	const { request, pages, currentPage } = options;
	const raw = (options.payload && typeof options.payload === 'object' ? options.payload : {}) as Record<
		string,
		unknown
	>;

	const gpc = request.headers.get('sec-gpc') === '1' || raw.gpc === true;

	const via = typeof raw.via === 'string' && SLUG.test(raw.via) ? raw.via : null;
	const utm = typeof raw.utmSource === 'string' && SLUG.test(raw.utmSource) ? raw.utmSource : null;
	const referrer =
		typeof raw.landingReferrer === 'string' && DOMAIN.test(raw.landingReferrer)
			? raw.landingReferrer
			: null;
	const arrivedVia = via
		? `campaign:${via}`
		: utm
			? `campaign:${utm}`
			: referrer
				? bucketReferrer(referrer)
				: 'direct';

	const timezone = validTimeZone(raw.timezone);
	let localTime: string | null = null;
	let localDateISO: string | null = null;
	if (timezone) {
		const now = new Date();
		const day = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' });
		const time = now
			.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
			.replace(' ', '')
			.toLowerCase();
		localTime = `${day} ${time}`;
		localDateISO = now.toLocaleDateString('en-CA', { timeZone: timezone });
	}

	// Only known site pages, deduped, in first-seen order; the page they're on now is listed separately
	const byPath = new Map(pages.map((p) => [p.path, p]));
	const seen = new Map<string, { title: string; kind: string; seconds: number }>();
	if (Array.isArray(raw.pagesSeen)) {
		for (const entry of raw.pagesSeen.slice(-MAX_PAGES)) {
			const e = entry as { path?: unknown; seconds?: unknown };
			if (typeof e?.path !== 'string' || e.path === currentPage) continue;
			const page = byPath.get(e.path);
			if (!page) continue;
			const seconds = typeof e.seconds === 'number' && e.seconds >= 0 ? Math.min(e.seconds, 3600) : 0;
			const prev = seen.get(e.path);
			if (prev) prev.seconds += seconds;
			else seen.set(e.path, { title: page.displayTitle, kind: pageKind(page.category), seconds });
		}
	}

	const country = request.headers.get('x-vercel-ip-country');

	return {
		arrivedVia,
		via,
		device: raw.device === 'mobile' ? 'mobile' : 'desktop',
		timezone,
		localTime,
		localDateISO,
		pagesSeen: [...seen.values()],
		language: languageName(request.headers.get('accept-language')),
		country: country && /^[A-Z]{2}$/.test(country) ? country : null,
		returning: raw.returning === true,
		gpc,
		// No lookup happens under GPC, but never carry one through either
		org: gpc ? null : options.org
	};
}

function dwell(seconds: number): string {
	if (seconds < 10) return 'glanced';
	if (seconds < 90) return `~${Math.round(seconds / 10) * 10}s`;
	return `~${Math.round(seconds / 60)} min`;
}

/** The "Visitor hints" block for the Live details section. Empty string when there's nothing to say. */
export function formatVisitorContextForPrompt(ctx: VisitorContext): string {
	const lines: string[] = [];

	if (ctx.arrivedVia.startsWith('campaign:')) {
		lines.push(`Arrived via a link Hunter shared, tagged "${ctx.arrivedVia.slice('campaign:'.length)}"`);
	} else if (ctx.arrivedVia === 'linkedin') lines.push('Arrived from LinkedIn');
	else if (ctx.arrivedVia === 'search') lines.push('Arrived from a search engine');
	else if (ctx.arrivedVia === 'social') lines.push('Arrived from a social/design community site');
	else if (ctx.arrivedVia.startsWith('referral:'))
		lines.push(`Arrived from another site (${ctx.arrivedVia.slice('referral:'.length)})`);

	if (ctx.org && ctx.org.orgClass === 'org') lines.push(`On the network of: ${ctx.org.name}`);

	if (ctx.device === 'mobile')
		lines.push(
			'On a phone: keep replies short and prefer related-page chips over route_to_page (the chat covers the page)'
		);

	if (ctx.localTime && ctx.timezone && ctx.localDateISO)
		lines.push(
			`Their local time: ${ctx.localTime} (${ctx.timezone}), their date ${ctx.localDateISO}. Use their date for relative days they mention; calendar results are in Hunter's time zone`
		);

	if (ctx.pagesSeen.length)
		lines.push(
			`Already read this visit: ${ctx.pagesSeen.map((p) => `${p.title} (${p.kind}, ${dwell(p.seconds)})`).join(', ')}`
		);

	if (ctx.language)
		lines.push(`Browser language: ${ctx.language} (reply in whatever language they write in)`);
	if (ctx.country) lines.push(`Country: ${ctx.country} (only for location-relative questions)`);
	if (ctx.returning) lines.push('Returning visitor');

	return lines.length ? `\n## Visitor hints (internal)\n${lines.map((l) => `- ${l}`).join('\n')}\n` : '';
}

/**
 * Hints for writing suggestion chips. Chips are text the visitor sees, so this carries only what
 * helps pick an angle (how they arrived, what they've read, phone vs desktop) and never the
 * network owner, location or language: a chip must not reveal what the site inferred about them.
 */
export function formatVisitorContextForChips(ctx: VisitorContext): string {
	const lines: string[] = [];

	if (ctx.arrivedVia.startsWith('campaign:'))
		lines.push(
			`Arrived via a link Hunter shared, tagged "${ctx.arrivedVia.slice('campaign:'.length)}": probably evaluating him for a role or project, so lead with his work and how he works`
		);
	else if (ctx.arrivedVia === 'linkedin')
		lines.push('Arrived from LinkedIn: probably evaluating him professionally, so lead with his work and how he works');
	else if (ctx.arrivedVia === 'search')
		lines.push('Arrived from a search engine: likely after something specific on this page, so stay close to it');
	else if (ctx.arrivedVia.startsWith('referral:')) {
		const domain = ctx.arrivedVia.slice('referral:'.length);
		lines.push(
			/(^|\.)(github\.com|dev\.to|vercel\.com)$/.test(domain)
				? 'Arrived from a developer site: one chip may be about how HuntBot or this site is built'
				: `Arrived from another site (${domain})`
		);
	}

	if (ctx.pagesSeen.length)
		lines.push(
			`Already read this visit: ${ctx.pagesSeen.map((p) => `${p.title} (${p.kind}, ${dwell(p.seconds)})`).join(', ')}. Build on what they spent time on; don't ask about pages they only glanced at`
		);
	if (ctx.returning) lines.push('Returning visitor: favour depth over introductions');
	if (ctx.device === 'mobile') lines.push('On a phone: keep each chip under 7 words');

	return lines.length
		? `\n\nVISITOR HINTS (use only to choose which angles to lead with; never mention or allude to how they arrived, what they read, or their device):\n${lines.map((l) => `- ${l}`).join('\n')}`
		: '';
}

/**
 * True when the reply names the visitor's network owner without the visitor having typed it
 * themselves. The prompt forbids that; this makes it measurable if it ever happens.
 */
export function replyMentionsOrg(
	reply: string,
	visitorText: string,
	org: IpOrg | null
): boolean {
	if (!org || org.orgClass !== 'org') return false;
	const core = coreOrgName(org.name).toLowerCase();
	if (core.length < 4) return false;
	return reply.toLowerCase().includes(core) && !visitorText.toLowerCase().includes(core);
}

/** PostHog properties for the chat_message event. Under GPC only the flag is recorded. */
export function visitorAnalyticsProps(
	ctx: VisitorContext | null,
	orgMentioned: boolean
): Record<string, unknown> {
	if (!ctx) return {};
	if (ctx.gpc) return { gpc: true };
	return {
		gpc: false,
		visitor_arrived_via: ctx.arrivedVia,
		visitor_via: ctx.via,
		visitor_device: ctx.device,
		visitor_timezone: ctx.timezone,
		visitor_language: ctx.language,
		visitor_country: ctx.country,
		visitor_org: ctx.org?.name ?? null,
		visitor_org_class: ctx.org?.orgClass ?? null,
		visitor_pages_seen: ctx.pagesSeen.map((p) => p.title),
		visitor_returning: ctx.returning,
		visitor_org_mentioned: orgMentioned
	};
}
