import { env } from '$env/dynamic/private';
import { parseRb2bRecord } from '$lib/server/rb2b';
import { putRecord } from '$lib/server/visitor-id-store';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';

// RB2B webhook: one POST per identified page view. RB2B doesn't sign its webhooks, so the secret
// path segment (RB2B_WEBHOOK_SECRET) is the guard, as RB2B recommends. Only company-level fields
// are kept, keyed by the `hb` token the page URL carried (see loadIdentityPixel); names, emails,
// LinkedIn URLs and other person-level fields in the payload are dropped here and never stored.

function secretMatches(given: string | undefined): boolean {
	const secret = env.RB2B_WEBHOOK_SECRET;
	if (!secret || !given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: RequestHandler = async ({ params, request }) => {
	if (!secretMatches(params.secret)) error(404, 'Not found');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false }, { status: 400 });
	}
	const records = Array.isArray(body) ? body.slice(0, 50) : [body];
	let stored = 0;
	let dropped = 0;
	for (const record of records) {
		const parsed = parseRb2bRecord(record);
		if (!parsed) {
			dropped++;
			continue;
		}
		await putRecord('pixel', parsed.token, { name: parsed.name, domain: parsed.domain });
		stored++;
	}
	// Counts only: the company names stay in the store, not in always-on logs.
	console.log('[HuntBot visitor-id]', JSON.stringify({ event: 'rb2b_webhook', stored, dropped }));
	return json({ ok: true });
};
