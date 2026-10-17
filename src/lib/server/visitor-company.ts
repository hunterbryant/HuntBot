import { coreOrgName, lookupIpOrg, simulatedOrg, type IpOrg } from '$lib/server/ip-org';
import { lookupIpCompany } from '$lib/server/ipapi-is';
import { companyFromReferrer } from '$lib/server/referrer-company';
import { getRecord } from '$lib/server/visitor-id-store';
import { parse } from 'tldts';

// Which company a visitor works at, from a stack of independent signals, best first:
//   simulated  `/simulate <Company>` (testing; treated like a network guess)
//   stated     they said so earlier in the chat (find_open_roles)
//   pixel      the RB2B identity pixel's report for this tab
//   referrer   they arrived from a company's internal tool (acme.atlassian.net)
//   ip_company the WHOIS owner of their IP block, when it's a business (ipapi.is)
//   ip_asn     the owner of their network's ASN, when it's an org (IPinfo Lite)
// The best available signal wins; another layer naming the same company raises confidence; a VPN /
// datacenter flag silences both IP layers. Never throws.

export type CompanySource = 'simulated' | 'stated' | 'pixel' | 'referrer' | 'ip_company' | 'ip_asn';
export type Confidence = 'certain' | 'high' | 'medium' | 'low';

export type VisitorCompany = {
	name: string;
	domain: string | null;
	source: CompanySource;
	confidence: Confidence;
	/** Other layers that named the same company. */
	agreedWith: CompanySource[];
};

export type CompanyResolution = {
	company: VisitorCompany | null;
	/** The IPinfo ASN record, kept for analytics (isp / mobile / hosting / org). */
	ipOrg: IpOrg | null;
	/** Every layer that returned a company, in priority order. */
	layers: CompanySource[];
	/** ipapi.is flagged the IP as a VPN, datacenter, proxy or Tor exit. */
	anonymized: boolean;
	ms: number;
};

const BASE: Record<CompanySource, Confidence> = {
	simulated: 'certain',
	stated: 'certain',
	pixel: 'high',
	referrer: 'medium',
	ip_company: 'medium',
	ip_asn: 'low'
};
const UP: Record<Confidence, Confidence> = {
	low: 'medium',
	medium: 'high',
	high: 'high',
	certain: 'certain'
};

const TOKEN = /^[a-z0-9]{12,32}$/;
const DOMAIN = /^[a-z0-9.-]{3,80}$/;
const PIXEL_POLL_MS = 750;

type Candidate = { name: string; domain: string | null; source: CompanySource };

const normName = (s: string) =>
	coreOrgName(s)
		.toLowerCase()
		.replace(/\b(the|technologies|technology|platforms|labs|holdings|group|company)\b/g, '')
		.replace(/[^a-z0-9]/g, '');
const domainLabel = (d: string | null) =>
	d ? (parse(d).domainWithoutSuffix ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') : '';

/** Whether two layers name the same company (normalized name or the same domain label). */
export function sameCompany(a: Candidate, b: Candidate): boolean {
	const da = domainLabel(a.domain);
	const db = domainLabel(b.domain);
	if (da && db && da === db) return true;
	const na = normName(a.name);
	const nb = normName(b.name);
	if (!na || !nb) return false;
	if (na === nb) return true;
	const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
	return short.length >= 4 && long.startsWith(short);
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2, certain: 3 };

/**
 * Picks the winner from candidates given in priority order. Each candidate's confidence is its
 * layer's, raised a level when another layer names the same company; the most confident wins and
 * priority breaks ties (so two IP layers that agree beat a lone referrer guess). Exported for tests.
 */
export function pick(candidates: Candidate[]): VisitorCompany | null {
	let best: VisitorCompany | null = null;
	for (const c of candidates) {
		const agreedWith = candidates.filter((o) => o !== c && sameCompany(c, o)).map((o) => o.source);
		const base = BASE[c.source];
		const scored: VisitorCompany = {
			name: c.name,
			domain:
				c.domain ??
				candidates.find((o) => o !== c && o.domain && sameCompany(c, o))?.domain ??
				null,
			source: c.source,
			confidence: agreedWith.length ? UP[base] : base,
			agreedWith
		};
		if (!best || RANK[scored.confidence] > RANK[best.confidence]) best = scored;
	}
	return best;
}

async function pixelCompany(token: string | null, waitMs: number): Promise<Candidate | null> {
	if (!token) return null;
	const deadline = Date.now() + waitMs;
	for (;;) {
		const record = await getRecord('pixel', token);
		if (record && typeof record.name === 'string') {
			return {
				name: record.name,
				domain: typeof record.domain === 'string' ? record.domain : null,
				source: 'pixel'
			};
		}
		if (Date.now() + PIXEL_POLL_MS > deadline) return null;
		await new Promise((r) => setTimeout(r, PIXEL_POLL_MS));
	}
}

export async function resolveVisitorCompany(options: {
	clientIp: string | null;
	/** The browser's visitor payload (re-validated here). */
	payload: unknown;
	/** Global Privacy Control: the IP layers are skipped (the pixel and stated layers still count). */
	gpc: boolean;
	/** `/simulate`, already validated and rate-limited by the caller. */
	simulated: IpOrg | null;
	/** How long to wait for the pixel's report to land (the chat-open opener waits; turns don't). */
	waitForPixelMs?: number;
}): Promise<CompanyResolution> {
	const t0 = Date.now();
	const raw = (
		options.payload && typeof options.payload === 'object' ? options.payload : {}
	) as Record<string, unknown>;
	const done = (company: VisitorCompany | null, rest: Partial<CompanyResolution> = {}) => ({
		company,
		ipOrg: null,
		layers: company ? [company.source] : [],
		anonymized: false,
		ms: Date.now() - t0,
		...rest
	});

	if (options.simulated) {
		return done(
			pick([
				{ name: options.simulated.name, domain: options.simulated.domain, source: 'simulated' }
			])
		);
	}
	const stated = simulatedOrg(raw.statedCompany);
	if (stated) return done(pick([{ name: stated.name, domain: null, source: 'stated' }]));

	const token =
		typeof raw.pixelToken === 'string' && TOKEN.test(raw.pixelToken) ? raw.pixelToken : null;
	const referrer =
		typeof raw.landingReferrer === 'string' && DOMAIN.test(raw.landingReferrer)
			? raw.landingReferrer
			: null;

	const [pixel, ref, ipCompany, ipOrg] = await Promise.all([
		pixelCompany(token, options.waitForPixelMs ?? 0).catch(() => null),
		companyFromReferrer(referrer).catch(() => null),
		options.gpc ? Promise.resolve(null) : lookupIpCompany(options.clientIp),
		options.gpc ? Promise.resolve(null) : lookupIpOrg(options.clientIp)
	]);

	const anonymized = Boolean(ipCompany?.anonymized);
	const candidates: Candidate[] = [];
	if (pixel) candidates.push(pixel);
	if (ref) candidates.push({ ...ref, source: 'referrer' });
	if (!anonymized && ipCompany?.company)
		candidates.push({ ...ipCompany.company, source: 'ip_company' });
	if (!anonymized && ipOrg?.orgClass === 'org') {
		candidates.push({ name: ipOrg.name, domain: ipOrg.domain, source: 'ip_asn' });
	}
	return done(pick(candidates), {
		ipOrg,
		layers: candidates.map((c) => c.source),
		anonymized
	});
}

/** The resolved company in the IpOrg shape the visitor hints and role lookup already use. */
export function companyAsOrg(resolution: CompanyResolution): IpOrg | null {
	const c = resolution.company;
	if (!c) return resolution.ipOrg;
	return {
		name: c.name,
		domain: c.domain,
		countryCode: resolution.ipOrg?.countryCode ?? null,
		orgClass: 'org'
	};
}

/** One `[HuntBot visitor-id]` line per resolution: sources and agreement, no visitor data. */
export function logResolution(runId: string, where: 'chat' | 'opener', r: CompanyResolution) {
	console.log(
		'[HuntBot visitor-id]',
		JSON.stringify({
			run_id: runId,
			where,
			source: r.company?.source ?? null,
			confidence: r.company?.confidence ?? null,
			agreed_with: r.company?.agreedWith ?? [],
			layers: r.layers,
			anonymized: r.anonymized,
			ip_org_class: r.ipOrg?.orgClass ?? null,
			ms: r.ms
		})
	);
}
