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

interface ConversationEvent {
	type: 'chat_message' | 'suggestion_clicked' | 'suggestions_shown';
	timestamp: string;
	userMessage: string | null;
	botResponse: string | null;
	functionCallName: string | null;
	functionCallArgs: string | null;
	currentPage: string | null;
	suggestionText: string | null;
	suggestionsShown: string[] | null;
	suggestionType: string | null;
	city: string | null;
	region: string | null;
	regionCode: string | null;
	country: string | null;
	countryCode: string | null;
	timezone: string | null;
	ip: string | null;
	lat: number | null;
	lon: number | null;
}

interface UserMeta {
	city: string | null;
	region: string | null;
	regionCode: string | null;
	country: string | null;
	countryCode: string | null;
	timezone: string | null;
	ip: string | null;
	lat: number | null;
	lon: number | null;
}

interface ConversationSummary {
	sessionId: string;
	startedAt: string;
	lastActiveAt: string;
	durationMs: number;
	hasNavigation: boolean;
	hasNotHelpful: boolean;
	userMeta: UserMeta;
	msgCount: number;
	userMsgCount: number;
	suggestionClickCount: number;
	pages: string[];
	pagesVisited: string;
	navDest: string | null;
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
		const [chatEvents, clickEvents, shownEvents, notHelpfulEvents] = await Promise.all([
			fetchPostHogEvents('chat_message', since),
			fetchPostHogEvents('suggestion_clicked', since),
			fetchPostHogEvents('suggestions_shown', since),
			fetchPostHogEvents('not_helpful', since)
		]);

		// Merge, tag with type, sort chronologically
		const all = [
			...chatEvents.map((e) => ({ ...e, _type: 'chat_message' as const })),
			...clickEvents.map((e) => ({ ...e, _type: 'suggestion_clicked' as const })),
			...shownEvents.map((e) => ({ ...e, _type: 'suggestions_shown' as const }))
		].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		const str = (v: unknown) => (typeof v === 'string' ? v : null);
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

		// Build a reverse lookup: distinct_id → session key (for not_helpful correlation)
		const distinctIdToSession = new Map<string, string>();
		for (const e of all) {
			const p = getProps(e);
			const key = str(p.session_id) ?? e.distinct_id;
			if (e.distinct_id) distinctIdToSession.set(e.distinct_id, key);
		}

		// Group by session_id
		const sessionMap = new Map<string, ConversationEvent[]>();
		for (const e of all) {
			const p = getProps(e);
			const num = (v: unknown) => (typeof v === 'number' ? v : null);
			const arr2str = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : null);
			const key = str(p.session_id) ?? e.distinct_id;
			const arr = sessionMap.get(key) ?? [];
			arr.push({
				type: e._type,
				timestamp: e.timestamp,
				userMessage: str(p.user_message),
				botResponse: str(p.bot_response),
				functionCallName: str(p.function_call_name),
				functionCallArgs: str(p.function_call_args),
				currentPage: str(p.current_page),
				suggestionText: str(p.suggestion_text),
				suggestionsShown: arr2str(p.suggestions),
				suggestionType: str(p.suggestion_type),
				city: str(p.$geoip_city_name),
				region: str(p.$geoip_subdivision_1_name),
				regionCode: str(p.$geoip_subdivision_1_code),
				country: str(p.$geoip_country_name),
				countryCode: str(p.$geoip_country_code),
				timezone: str(p.$geoip_time_zone),
				ip: str(p.$ip),
				lat: num(p.$geoip_latitude),
				lon: num(p.$geoip_longitude)
			});
			sessionMap.set(key, arr);
		}

		const notHelpfulSessions = new Set<string>();
		for (const e of notHelpfulEvents) {
			const p = getProps(e);
			const sid = str(p.session_id);
			if (sid) {
				notHelpfulSessions.add(sid);
			} else {
				// Resolve via distinct_id → session key mapping built from chat events
				const resolved = distinctIdToSession.get(e.distinct_id);
				if (resolved) notHelpfulSessions.add(resolved);
				else if (e.distinct_id) notHelpfulSessions.add(e.distinct_id); // last-resort fallback
			}
		}

		// Build eventsMap alongside summaries
		const eventsMap: Record<string, ConversationEvent[]> = {};

		const conversations: ConversationSummary[] = Array.from(sessionMap.entries())
			.map(([sessionId, events]) => {
				// Store events in the map for the response
				eventsMap[sessionId] = events;

				const firstWithMeta = events.find((e) => e.city || e.timezone);
				const userMeta: UserMeta = {
					city: firstWithMeta?.city ?? null,
					region: firstWithMeta?.region ?? null,
					regionCode: firstWithMeta?.regionCode ?? null,
					country: firstWithMeta?.country ?? null,
					countryCode: firstWithMeta?.countryCode ?? null,
					timezone: firstWithMeta?.timezone ?? null,
					ip: firstWithMeta?.ip ?? null,
					lat: firstWithMeta?.lat ?? null,
					lon: firstWithMeta?.lon ?? null
				};
				const startedAt = events[0].timestamp;
				const lastActiveAt = events[events.length - 1].timestamp;

				// Pre-compute counts
				const msgCount = events.filter((e) => e.type === 'chat_message').length;
				const userMsgCount = events.filter(
					(e) => e.type === 'chat_message' && e.userMessage
				).length;
				const suggestionClickCount = events.filter(
					(e) => e.type === 'suggestion_clicked'
				).length;

				// Pre-compute pages visited
				const pages = [...new Set(events.map((e) => e.currentPage).filter(Boolean))] as string[];
				const pagesVisited = pages.join(' → ');

				// Pre-compute nav destination
				let navDest: string | null = null;
				const navEventByField = events.find((e) => e.functionCallName !== null);
				if (navEventByField?.functionCallArgs) {
					try {
						const parsed = JSON.parse(navEventByField.functionCallArgs);
						navDest = parsed.page ?? null;
					} catch {
						/* ignore */
					}
				} else {
					// Fallback: check botResponse JSON for function_call.arguments.page
					for (const e of events) {
						if (e.botResponse) {
							try {
								const parsed = JSON.parse(e.botResponse);
								if (parsed.function_call?.arguments) {
									const args =
										typeof parsed.function_call.arguments === 'string'
											? JSON.parse(parsed.function_call.arguments)
											: parsed.function_call.arguments;
									if (args?.page) {
										navDest = args.page;
										break;
									}
								}
							} catch {
								/* ignore */
							}
						}
					}
				}

				return {
					sessionId,
					startedAt,
					lastActiveAt,
					durationMs: new Date(lastActiveAt).getTime() - new Date(startedAt).getTime(),
					hasNavigation: events.some((e) => {
						if (e.functionCallName !== null) return true;
						if (e.botResponse) {
							try {
								return !!(JSON.parse(e.botResponse).function_call?.name);
							} catch {
								/* */
							}
						}
						return false;
					}),
					hasNotHelpful: notHelpfulSessions.has(sessionId),
					userMeta,
					msgCount,
					userMsgCount,
					suggestionClickCount,
					pages,
					pagesVisited,
					navDest
				};
			})
			.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

		const notHelpfulCount = notHelpfulSessions.size;

		return json(
			{ conversations, events: eventsMap, notHelpfulCount, fetchedAt: new Date().toISOString() },
			{ headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=30' } }
		);
	} catch (err) {
		console.error('Conversations fetch failed:', err);
		return json(
			{ error: `Failed to fetch conversations: ${err}`, conversations: [] },
			{ status: 502 }
		);
	}
};
