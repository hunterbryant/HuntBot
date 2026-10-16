import { env as publicEnv } from '$env/dynamic/public';
import { waitUntil } from '@vercel/functions';

/** distinct_id for server-side jobs with no visitor behind them (e.g. the chunk audit). */
export const SYSTEM_DISTINCT_ID = 'huntbot-system';

/**
 * Send one server-side event to PostHog. The request is registered with Vercel's `waitUntil`, so
 * it still completes when it's sent after the response has finished (a plain un-awaited fetch can
 * be frozen with the function and silently lost). Failures never throw, but they are logged as
 * `[HuntBot analytics]` lines, so a gap in PostHog shows up in the Vercel logs.
 */
export function captureServerEvent(
	event: string,
	distinctId: string,
	properties: Record<string, unknown>
): Promise<void> {
	const apiKey = publicEnv.PUBLIC_POSTHOG_API_KEY;
	if (!apiKey) return Promise.resolve();

	const sent = fetch('https://us.i.posthog.com/capture/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: apiKey,
			event,
			distinct_id: distinctId,
			timestamp: new Date().toISOString(),
			properties
		}),
		signal: AbortSignal.timeout(10_000)
	})
		.then((res) => {
			if (!res.ok) {
				console.warn('[HuntBot analytics]', JSON.stringify({ event, status: res.status }));
			}
		})
		.catch((err) => {
			console.warn('[HuntBot analytics]', JSON.stringify({ event, error: String(err) }));
		});
	waitUntil(sent);
	return sent;
}

/** Keep background work (post-reply audits, analytics) alive after the response ends. */
export function runInBackground(task: Promise<unknown>): void {
	waitUntil(task);
}
