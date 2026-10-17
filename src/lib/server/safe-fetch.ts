import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

// Fetches a URL a visitor typed, from our server. That makes it a request-forgery risk: a link to
// http://169.254.169.254/ or an internal hostname would make us fetch things only our network can
// see. So: https only, the hostname must resolve to public addresses only, the connection is pinned
// to the address we checked (a second DNS answer can't swap in a private one), redirects are
// followed by hand and re-checked, and time, size and content type are capped.

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = /^(text\/(html|plain)|application\/(xhtml\+xml|json))\b/i;

// Everything that isn't the public internet.
const blocked = new BlockList();
for (const [net, bits] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const) {
	blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
	['::', 128],
	['::1', 128],
	['64:ff9b::', 96],
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const) {
	blocked.addSubnet(net, bits, 'ipv6');
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return true;
	// IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged by the IPv4 address inside it.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
	if (mapped) return isPrivateAddress(mapped[1]);
	return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export type SafeFetchResult =
	| { ok: true; text: string; contentType: string; finalUrl: string }
	| { ok: false; reason: string; status?: number };

/** Checks a URL's shape and resolves its host to one public address, or says why not. */
export async function resolvePublicHost(
	rawUrl: string
): Promise<{ url: URL; address: string; family: 4 | 6 } | { reason: string }> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { reason: 'not a valid URL' };
	}
	if (url.protocol !== 'https:') return { reason: 'only https links are allowed' };
	if (url.username || url.password) return { reason: 'links with credentials are not allowed' };
	if (url.port && url.port !== '443') return { reason: 'only the standard https port is allowed' };

	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) {
		return isPrivateAddress(host)
			? { reason: 'that address is not public' }
			: { url, address: host, family: isIP(host) as 4 | 6 };
	}
	try {
		const addresses = await lookup(host, { all: true });
		if (addresses.length === 0) return { reason: 'the host did not resolve' };
		// One private answer among public ones is still a rebinding risk: refuse the lot.
		if (addresses.some((a) => isPrivateAddress(a.address))) {
			return { reason: 'that host resolves to a non-public address' };
		}
		return { url, address: addresses[0].address, family: addresses[0].family as 4 | 6 };
	} catch {
		return { reason: 'the host did not resolve' };
	}
}

function once(
	url: URL,
	address: string,
	family: 4 | 6,
	truncate: boolean
): Promise<{ status: number; location: string | null; contentType: string; body: Buffer | null }> {
	return new Promise((resolve, reject) => {
		const req = httpsRequest(
			{
				host: url.hostname.replace(/^\[|\]$/g, ''),
				servername: url.hostname,
				path: `${url.pathname}${url.search}`,
				method: 'GET',
				headers: {
					Host: url.host,
					'User-Agent': 'Mozilla/5.0 (compatible; HuntBot/1.0; +https://www.hunterbryant.io)',
					Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1',
					'Accept-Encoding': 'gzip, br, deflate'
				},
				// Pin the connection to the address that was checked.
				// Node asks for every address when it tries IPv4 and IPv6 in turn (`all: true`).
				lookup: (_host, opts, cb) =>
					(opts as { all?: boolean })?.all
						? (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
								{ address, family }
							])
						: cb(null, address, family),
				timeout: TIMEOUT_MS
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const location = typeof res.headers.location === 'string' ? res.headers.location : null;
				const contentType = String(res.headers['content-type'] ?? '');
				if (status >= 300 && status < 400) {
					res.resume();
					return resolve({ status, location, contentType, body: null });
				}
				if (status < 200 || status >= 300 || !ALLOWED_TYPES.test(contentType)) {
					res.resume();
					return resolve({ status, location: null, contentType, body: null });
				}

				const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
				const stream =
					encoding === 'gzip'
						? res.pipe(createGunzip())
						: encoding === 'br'
							? res.pipe(createBrotliDecompress())
							: encoding === 'deflate'
								? res.pipe(createInflate())
								: res;
				const chunks: Buffer[] = [];
				let size = 0;
				let truncated = false;
				stream.on('data', (chunk: Buffer) => {
					size += chunk.length;
					// Counted after decompression, so a zip bomb stops at the same cap.
					if (size > MAX_BYTES) {
						if (truncate) {
							// Pages with big inline scripts: keep the first MAX_BYTES, stop reading.
							if (!truncated) {
								truncated = true;
								resolve({ status, location: null, contentType, body: Buffer.concat(chunks) });
								req.destroy();
							}
							return;
						}
						req.destroy(new Error('response too large'));
						return;
					}
					chunks.push(chunk);
				});
				stream.on('end', () =>
					resolve({ status, location: null, contentType, body: Buffer.concat(chunks) })
				);
				stream.on('error', (error) => (truncated ? undefined : reject(error)));
			}
		);
		req.on('timeout', () => req.destroy(new Error('timed out')));
		req.on('error', reject);
		req.end();
	});
}

/** Fetches a visitor-supplied URL as text, safely. Never throws. */
export async function safeFetchText(
	rawUrl: string,
	{ truncate = false }: { truncate?: boolean } = {}
): Promise<SafeFetchResult> {
	let current = rawUrl;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const target = await resolvePublicHost(current);
		if ('reason' in target) return { ok: false, reason: target.reason };
		try {
			const res = await once(target.url, target.address, target.family, truncate);
			if (res.status >= 300 && res.status < 400 && res.location) {
				// Each hop goes back through the same checks.
				current = new URL(res.location, target.url).toString();
				continue;
			}
			if (!res.body) {
				return {
					ok: false,
					reason:
						res.status >= 200 && res.status < 300
							? 'that link is not a web page or text'
							: `the page returned ${res.status || 'an error'}`,
					status: res.status || undefined
				};
			}
			return {
				ok: true,
				text: res.body.toString('utf8'),
				contentType: res.contentType,
				finalUrl: target.url.toString()
			};
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : 'the request failed' };
		}
	}
	return { ok: false, reason: 'too many redirects' };
}
