import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a request carries the eval header (`x-huntbot-eval` = CRON_SECRET), sent by
 * `pnpm eval`. Constant-time compare, since this endpoint is public and the secret is also the
 * cron credential. Only used to tag eval traffic as admin traffic and to allow `/simulate`.
 */
export function isEvalRequest(request: Request): boolean {
	const secret = env.CRON_SECRET;
	const given = request.headers.get('x-huntbot-eval');
	if (!secret || !given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}
