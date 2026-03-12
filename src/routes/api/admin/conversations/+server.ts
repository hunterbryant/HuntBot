import { env } from '$env/dynamic/private';
import { authenticateUser } from '$lib/server/auth';
import { UserRole } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';

interface PostHogEvent {
	uuid: string;
	timestamp: string;
	distinct_id: string;
	properties: Record<string, string | null>;
}

interface ConversationEvent {
	type: 'chat_message' | 'suggestion_clicked';
	timestamp: string;
	userMessage: string | null;
	botResponse: string | null;
	functionCallName: string | null;
	functionCallArgs: string | null;
	currentPage: string | null;
	suggestionText: string | null;
}

interface Conversation {
	sessionId: string;
	startedAt: string;
	lastActiveAt: string;
	events: ConversationEvent[];
}

async function fetchPostHogEvents(event: string, since: string): Promise<PostHogEvent[]> {
	const projectId = env.POSTHOG_PROJECT_ID;
	const personalKey = env.POSTHOG_PERSONAL_API_KEY;
	if (!projectId || !personalKey) return [];

	const url = new URL(`https://us.posthog.com/api/projects/${projectId}/events/`);
	url.searchParams.set('event', event);
	url.searchParams.set('after', since);
	url.searchParams.set('limit', '500');
	url.searchParams.set('orderBy', '["timestamp"]');

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${personalKey}` }
	});
	if (!res.ok) throw new Error(`PostHog API error: ${res.status} ${await res.text()}`);
	const data = await res.json();
	return (data.results as PostHogEvent[]) ?? [];
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const user = authenticateUser(cookies);
	if (!user || user.role !== UserRole.ADMIN) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const days = Math.min(parseInt(url.searchParams.get('days') ?? '30'), 90);
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	try {
		const [chatEvents, clickEvents] = await Promise.all([
			fetchPostHogEvents('chat_message', since),
			fetchPostHogEvents('suggestion_clicked', since)
		]);

		// Merge, tag with type, sort chronologically
		const all = [
			...chatEvents.map((e) => ({ ...e, _type: 'chat_message' as const })),
			...clickEvents.map((e) => ({ ...e, _type: 'suggestion_clicked' as const }))
		].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		// Group by session_id
		const sessionMap = new Map<string, ConversationEvent[]>();
		for (const e of all) {
			const key = e.properties.session_id ?? e.distinct_id;
			const arr = sessionMap.get(key) ?? [];
			arr.push({
				type: e._type,
				timestamp: e.timestamp,
				userMessage: e.properties.user_message ?? null,
				botResponse: e.properties.bot_response ?? null,
				functionCallName: e.properties.function_call_name ?? null,
				functionCallArgs: e.properties.function_call_args ?? null,
				currentPage: e.properties.current_page ?? null,
				suggestionText: e.properties.suggestion_text ?? null
			});
			sessionMap.set(key, arr);
		}

		const conversations: Conversation[] = Array.from(sessionMap.entries())
			.map(([sessionId, events]) => ({
				sessionId,
				startedAt: events[0].timestamp,
				lastActiveAt: events[events.length - 1].timestamp,
				events
			}))
			.sort(
				(a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
			);

		return json({ conversations, fetchedAt: new Date().toISOString() });
	} catch (err) {
		console.error('Conversations fetch failed:', err);
		return json(
			{ error: `Failed to fetch conversations: ${err}`, conversations: [] },
			{ status: 502 }
		);
	}
};
