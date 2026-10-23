import { authenticateUser } from '$lib/server/auth';
import { runHogQL } from '$lib/server/posthog-query';
import { UserRole } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';
import type { ConversationSummary } from '../../../admin/conversations/types';

const DAYS = 90;
const CACHE_MS = 60_000;

// One scan over the window: events are folded into one row per session, so only the columns the
// list shows leave PostHog. Transcripts load per session from /[sessionId].
// Client events use the browser session id as distinct_id and server events use the same id as
// session_id, so the key is session_id with distinct_id as the fallback.
const SUMMARY_SQL = `
SELECT
  coalesce(nullIf(toString(properties.session_id), ''), distinct_id) AS session_id,
  min(timestamp) AS started_at,
  max(timestamp) AS last_active_at,
  countIf(event = 'chat_message') AS msg_count,
  countIf(event = 'chat_message' AND nullIf(toString(properties.user_message), '') IS NOT NULL) AS user_msg_count,
  countIf(event = 'suggestion_clicked') AS click_count,
  countIf(event = 'contact_clicked') AS contact_clicks,
  countIf(event = 'not_helpful') AS not_helpful,
  countIf(event = 'chat_opened') > 0 AS opened,
  argMinIf(toString(properties.user_message), timestamp, event = 'chat_message' AND nullIf(toString(properties.user_message), '') IS NOT NULL) AS first_question,
  argMinIf(toString(properties.function_call_args), timestamp, event = 'chat_message' AND nullIf(toString(properties.function_call_name), '') IS NOT NULL) AS nav_args,
  countIf(event = 'chat_message' AND nullIf(toString(properties.function_call_name), '') IS NOT NULL) > 0 AS has_navigation,
  argMinIf(toString(properties.visitor_org), timestamp, event = 'chat_message' AND toString(properties.visitor_org_class) = 'org') AS org,
  argMinIf(toString(properties.visitor_company_source), timestamp, event = 'chat_message' AND toString(properties.visitor_org_class) = 'org') AS org_source,
  maxIf(toString(properties.is_admin) = 'true', event = 'chat_message') AS is_admin,
  groupUniqArrayIf(toString(properties.current_page), event IN ('chat_message', 'suggestion_clicked') AND nullIf(toString(properties.current_page), '') IS NOT NULL) AS pages,
  minIf(toFloat(properties.grounding_score), event = 'rag_grounding' AND toFloat(properties.makes_claims_probability) > 0.5) AS min_grounding,
  countIf(event = 'rag_grounding' AND toFloat(properties.admits_miss_probability) > 0.5) AS misses,
  countIf(event = 'rag_grounding' AND toFloat(properties.speaks_as_hunter_probability) > 0.5) AS spoke_as_hunter,
  countIf(event = 'chat_message' AND (nullIf(toString(properties.model_failure), '') IS NOT NULL OR toString(properties.pipeline_error) = 'true')) AS failures,
  argMinIf(toString(properties.$geoip_city_name), timestamp, event = 'chat_message' AND nullIf(toString(properties.$geoip_city_name), '') IS NOT NULL) AS city,
  argMinIf(toString(properties.$geoip_subdivision_1_name), timestamp, event = 'chat_message' AND nullIf(toString(properties.$geoip_city_name), '') IS NOT NULL) AS region,
  argMinIf(toString(properties.$geoip_country_name), timestamp, event = 'chat_message' AND nullIf(toString(properties.$geoip_city_name), '') IS NOT NULL) AS country,
  argMinIf(toString(properties.$geoip_time_zone), timestamp, event = 'chat_message' AND nullIf(toString(properties.$geoip_time_zone), '') IS NOT NULL) AS timezone,
  argMinIf(toString(properties.$ip), timestamp, event = 'chat_message' AND nullIf(toString(properties.$ip), '') IS NOT NULL) AS ip,
  argMinIf(toFloat(properties.$geoip_latitude), timestamp, event = 'chat_message' AND toFloat(properties.$geoip_latitude) IS NOT NULL) AS lat,
  argMinIf(toFloat(properties.$geoip_longitude), timestamp, event = 'chat_message' AND toFloat(properties.$geoip_longitude) IS NOT NULL) AS lon,
  argMinIf(coalesce(nullIf(toString(properties.visitor_arrived_via), ''), nullIf(toString(properties.via), ''), nullIf(toString(properties.landing_referrer), '')), timestamp, event IN ('chat_message', 'chat_opened')) AS arrived_via,
  maxIf(toString(properties.gpc) = 'true', event = 'chat_message') AS gpc
FROM events
WHERE timestamp >= now() - INTERVAL ${DAYS} DAY
  AND event IN ('chat_message', 'suggestion_clicked', 'not_helpful', 'chat_opened', 'contact_clicked', 'rag_grounding')
GROUP BY session_id
ORDER BY last_active_at DESC
LIMIT 2000
`;

type Row = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function navDest(args: unknown): string | null {
	const raw = str(args);
	if (!raw) return null;
	try {
		return (JSON.parse(raw) as { page?: string }).page ?? null;
	} catch {
		return null;
	}
}

function toSummary(r: Row): ConversationSummary {
	const sessionId = String(r.session_id);
	const startedAt = str(r.started_at) ?? new Date(0).toISOString();
	const lastActiveAt = str(r.last_active_at) ?? startedAt;
	return {
		sessionId,
		startedAt,
		lastActiveAt,
		durationMs: new Date(lastActiveAt).getTime() - new Date(startedAt).getTime(),
		msgCount: Number(r.msg_count) || 0,
		userMsgCount: Number(r.user_msg_count) || 0,
		suggestionClickCount: Number(r.click_count) || 0,
		contactClicks: Number(r.contact_clicks) || 0,
		notHelpfulCount: Number(r.not_helpful) || 0,
		opened: Boolean(r.opened),
		firstQuestion: str(r.first_question),
		navDest: navDest(r.nav_args),
		hasNavigation: Boolean(r.has_navigation),
		org: str(r.org),
		orgSource: str(r.org_source),
		isAdmin: Boolean(r.is_admin),
		isTest: /^(eval|verify)-/.test(sessionId),
		pages: Array.isArray(r.pages) ? (r.pages as unknown[]).map(String).sort() : [],
		minGrounding: num(r.min_grounding),
		misses: Number(r.misses) || 0,
		spokeAsHunter: Number(r.spoke_as_hunter) || 0,
		failures: Number(r.failures) || 0,
		meta: {
			city: str(r.city),
			region: str(r.region),
			country: str(r.country),
			timezone: str(r.timezone),
			ip: str(r.ip),
			lat: num(r.lat),
			lon: num(r.lon),
			arrivedVia: str(r.arrived_via),
			gpc: Boolean(r.gpc)
		}
	};
}

let cache: {
	at: number;
	body: { conversations: ConversationSummary[]; fetchedAt: string };
} | null = null;

export const GET: RequestHandler = async ({ cookies, url }) => {
	const user = authenticateUser(cookies);
	if (!user || user.role !== UserRole.ADMIN) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const fresh = url.searchParams.has('fresh');
	if (!fresh && cache && Date.now() - cache.at < CACHE_MS) {
		return json(cache.body, { headers: { 'Cache-Control': 'private, max-age=60' } });
	}

	try {
		const rows = await runHogQL<Row>(SUMMARY_SQL);
		if (rows === null) {
			return json(
				{ error: 'POSTHOG_PROJECT_ID or POSTHOG_PERSONAL_API_KEY is not set', conversations: [] },
				{ status: 503 }
			);
		}
		const body = { conversations: rows.map(toSummary), fetchedAt: new Date().toISOString() };
		cache = { at: Date.now(), body };
		return json(body, { headers: { 'Cache-Control': 'private, max-age=60' } });
	} catch (err) {
		console.error('Conversations fetch failed:', err);
		return json({ error: String(err), conversations: [] }, { status: 502 });
	}
};
