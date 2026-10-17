// Parsing for RB2B webhook records (see routes/api/visitor-id/rb2b). Only the company-level fields
// and the `hb` token from the page URL are read; person-level fields are never touched.

import { isPixelToken } from '$lib/pixel-token';
import { oneLine } from '$lib/server/clean-text';

const field = (record: Record<string, unknown>, ...names: string[]) => {
	for (const n of names) {
		const v = record[n];
		if (typeof v === 'string' && v.trim()) return v.trim();
	}
	return null;
};

/** Token and company from one RB2B record, or null. */
export function parseRb2bRecord(
	record: unknown
): { token: string; name: string; domain: string | null } | null {
	if (!record || typeof record !== 'object') return null;
	const r = record as Record<string, unknown>;
	const url = field(r, 'Captured URL', 'captured_url', 'capturedUrl');
	const name = field(r, 'Company Name', 'company_name', 'companyName');
	if (!url || !name) return null;
	let token: string | null = null;
	try {
		token = new URL(url).searchParams.get('hb');
	} catch {
		return null;
	}
	if (!token || !isPixelToken(token)) return null;
	const website = field(r, 'Website', 'website', 'Company Website');
	let domain: string | null = null;
	if (website) {
		try {
			domain = new URL(website.includes('://') ? website : `https://${website}`).hostname
				.replace(/^www\./, '')
				.toLowerCase();
		} catch {
			domain = null;
		}
	}
	// eslint-disable-next-line no-control-regex -- stripping control characters is the point
	return { token, name: oneLine(name, 80), domain };
}
