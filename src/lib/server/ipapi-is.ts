import { env } from '$env/dynamic/private';
import { isPublicIp } from '$lib/server/ip-org';

// ipapi.is: the WHOIS owner of the visitor's IP block (`company`), which catches company offices
// whose addresses sit inside an ISP's ASN (IPinfo Lite only sees the ASN), plus VPN / datacenter /
// proxy flags so a VPN exit isn't mistaken for a company. Free account: 1,000 lookups a day with
// IPAPI_IS_KEY. Never throws.

export type IpCompany = {
	/** The block owner when ipapi.is classes it as a business; null for ISPs, hosting, schools. */
	company: { name: string; domain: string | null } | null;
	/** VPN, datacenter, proxy or Tor: neither IP layer should name a company. */
	anonymized: boolean;
	type: string | null;
};

const TIMEOUT_MS = 800;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX = 500;
const FAILURE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: IpCompany | null }>();

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parses an ipapi.is response. Exported for tests. */
export function parseIpapiIs(data: unknown): IpCompany | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as Record<string, unknown>;
	const company = (d.company ?? {}) as Record<string, unknown>;
	const type = str(company.type);
	const anonymized = Boolean(d.is_vpn || d.is_datacenter || d.is_proxy || d.is_tor);
	const name = str(company.name);
	return {
		company:
			name && type === 'business' && !anonymized
				? { name, domain: str(company.domain)?.toLowerCase() ?? null }
				: null,
		anonymized,
		type
	};
}

export async function lookupIpCompany(ip: string | null): Promise<IpCompany | null> {
	const key = env.IPAPI_IS_KEY;
	if (!key || !ip || !isPublicIp(ip)) return null;
	const hit = cache.get(ip);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

	let value: IpCompany | null = null;
	let ok = false;
	try {
		const res = await fetch(
			`https://api.ipapi.is/?q=${encodeURIComponent(ip)}&key=${encodeURIComponent(key)}`,
			{ signal: AbortSignal.timeout(TIMEOUT_MS) }
		);
		if (res.ok) {
			value = parseIpapiIs(await res.json());
			ok = true;
		}
	} catch {
		// timeout or network error: the layer just stays quiet
	}
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	// A failure (timeout, 429 after the daily quota, 5xx) is only remembered briefly: for an hour it
	// would leave the VPN flag off for that address.
	cache.set(ip, { at: ok ? Date.now() : Date.now() - CACHE_TTL_MS + FAILURE_TTL_MS, value });
	return value;
}
