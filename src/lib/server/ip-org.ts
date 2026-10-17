import { env } from '$env/dynamic/private';

// Reverse-IP lookup via IPinfo Lite (free): returns the network owner (ASN), not a verified
// employer. For most home and mobile visitors that's an ISP, so the result is classified and only
// a plain `org` reaches the prompt (see visitor-context.ts).

export type OrgClass = 'isp' | 'mobile' | 'hosting' | 'org';

export type IpOrg = {
	name: string;
	domain: string | null;
	countryCode: string | null;
	orgClass: OrgClass;
};

const TIMEOUT_MS = 800;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

// Networks that say "this is a consumer connection or a datacenter", not "this is a company".
const MOBILE =
	/\b(t-?mobile|verizon wireless|cellco|vodafone|orange|telefonica|o2|mobile|wireless|cellular|lte)\b/i;
const ISP =
	/\b(comcast|xfinity|verizon|at&t|att|charter|spectrum|cox|centurylink|lumen|frontier|optimum|altice|sky|bt|virgin media|telekom|telstra|rogers|bell canada|shaw|telus|swisscom|proximus|kpn|ziggo|free sas|bouygues|sfr|wind tre|tim|broadband|cable|telecom|communications|internet service|fibre|fiber|dsl|isp)\b/i;
const HOSTING =
	/\b(amazon|aws|google (cloud|llc)|microsoft|azure|digitalocean|linode|akamai|ovh|hetzner|cloudflare|fastly|vultr|oracle cloud|m247|datacamp|choopa|leaseweb|colo|hosting|vpn|proxy|tor|datacenter|data center|cloud)\b/i;

export function classifyOrg(name: string, domain: string | null): OrgClass {
	const haystack = `${name} ${domain ?? ''}`;
	if (MOBILE.test(haystack)) return 'mobile';
	if (HOSTING.test(haystack)) return 'hosting';
	if (ISP.test(haystack)) return 'isp';
	return 'org';
}

const cache = new Map<string, { at: number; value: IpOrg | null }>();

export function isPublicIp(ip: string): boolean {
	if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.')) return false;
	if (ip.startsWith('192.168.') || ip.startsWith('169.254.')) return false;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
	if (/^(fc|fd|fe80)/i.test(ip)) return false;
	return true;
}

/** Looks up the network owner for an IP. Never throws; null on no token, private IP or failure. */
export async function lookupIpOrg(ip: string | null): Promise<IpOrg | null> {
	const token = env.IPINFO_TOKEN;
	if (!token || !ip || !isPublicIp(ip)) return null;

	const hit = cache.get(ip);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

	let value: IpOrg | null = null;
	try {
		const res = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${token}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (res.ok) {
			const data = (await res.json()) as {
				as_name?: string;
				as_domain?: string;
				country_code?: string;
			};
			if (data.as_name) {
				value = {
					name: data.as_name,
					domain: data.as_domain ?? null,
					countryCode: data.country_code ?? null,
					orgClass: classifyOrg(data.as_name, data.as_domain ?? null)
				};
			}
		}
	} catch {
		// timeout or network error: the turn just goes without it
	}

	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(ip, { at: Date.now(), value });
	return value;
}

/**
 * A company name typed by the visitor with `/simulate <Company>` (a way to see the open-role
 * opener without being on a company network). Only names that look like names get through; the
 * result is treated like a real company network for that visitor's own chat.
 */
export function simulatedOrg(value: unknown): IpOrg | null {
	if (typeof value !== 'string') return null;
	const name = value.trim();
	if (!/^[\p{L}\p{N} .&'’-]{2,60}$/u.test(name)) return null;
	return { name, domain: null, countryCode: null, orgClass: 'org' };
}

/** Strips legal suffixes and punctuation so "ACME-CORP, INC." can be matched in reply text. */
export function coreOrgName(name: string): string {
	return name
		.replace(
			/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|ag|as|asn|autonomous system)\b\.?/gi,
			''
		)
		.replace(/[^a-z0-9 ]+/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
