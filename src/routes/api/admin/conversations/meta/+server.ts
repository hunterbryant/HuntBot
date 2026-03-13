import { env } from '$env/dynamic/private';
import { authenticateUser } from '$lib/server/auth';
import { UserRole } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';

interface PostHogEvent {
	uuid: string;
	timestamp: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

async function fetchPostHogEvents(event: string, since: string): Promise<PostHogEvent[]> {
	const projectId = env.POSTHOG_PROJECT_ID;
	const personalKey = env.POSTHOG_PERSONAL_API_KEY;
	if (!projectId || !personalKey) return [];

	const url = new URL(`https://us.posthog.com/api/projects/${projectId}/events/`);
	url.searchParams.set('event', event);
	url.searchParams.set('after', since);
	url.searchParams.set('limit', '500');

	try {
		const res = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${personalKey}` }
		});
		if (!res.ok) {
			console.warn(`PostHog API error for event "${event}": ${res.status} ${await res.text()}`);
			return [];
		}
		const data = await res.json();
		return (data.results as PostHogEvent[]) ?? [];
	} catch (err) {
		console.warn(`PostHog fetch failed for event "${event}":`, err);
		return [];
	}
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const user = authenticateUser(cookies);
	if (!user || user.role !== UserRole.ADMIN) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const days = Math.min(parseInt(url.searchParams.get('days') ?? '30'), 90);
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	try {
		const openedEvents = await fetchPostHogEvents('chat_opened', since);

		const getProps = (e: PostHogEvent): Record<string, unknown> => {
			const p = e.properties;
			if (typeof p === 'string') {
				try {
					return (JSON.parse(p) as Record<string, unknown>) ?? {};
				} catch {
					return {};
				}
			}
			return (p as Record<string, unknown>) ?? {};
		};

		const chatOpenedCount = new Set(
			openedEvents
				.filter((e) => !String(getProps(e).current_page ?? '').startsWith('/admin'))
				.map((e) => String(getProps(e).session_id ?? e.distinct_id))
		).size;

		return json(
			{ chatOpenedCount },
			{ headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=30' } }
		);
	} catch (err) {
		console.error('Conversations meta fetch failed:', err);
		return json({ error: `Failed to fetch meta: ${err}`, chatOpenedCount: 0 }, { status: 502 });
	}
};
