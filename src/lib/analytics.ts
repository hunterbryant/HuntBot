import { env } from '$env/dynamic/public';

export function captureEvent(
	event: string,
	distinctId: string,
	properties: Record<string, unknown>
) {
	const key = env.PUBLIC_POSTHOG_API_KEY;
	if (!key) return;
	fetch('https://us.i.posthog.com/capture/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: key,
			event,
			distinct_id: distinctId,
			timestamp: new Date().toISOString(),
			properties
		})
	}).catch(() => {});
}
