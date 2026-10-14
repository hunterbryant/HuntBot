import { env } from '$env/dynamic/public';

export function captureEvent(
	event: string,
	distinctId: string,
	properties: Record<string, unknown>
) {
	const key = env.PUBLIC_POSTHOG_API_KEY;
	if (!key) return;
	// Raw capture API (no posthog-js), so send the browser context ourselves — without a user
	// agent PostHog classifies every event as Automation traffic.
	const browserContext =
		typeof window !== 'undefined'
			? {
					$raw_user_agent: navigator.userAgent,
					$current_url: window.location.href,
					$pathname: window.location.pathname,
					$host: window.location.host,
					$referrer: document.referrer || '$direct'
				}
			: {};
	fetch('https://us.i.posthog.com/capture/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: key,
			event,
			distinct_id: distinctId,
			timestamp: new Date().toISOString(),
			properties: { ...browserContext, ...properties }
		})
	}).catch(() => {});
}
