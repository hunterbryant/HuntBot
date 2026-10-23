import { authenticateUser } from '$lib/server/auth';
import { num, runHogQL, str } from '$lib/server/posthog-query';
import { UserRole } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';
import type { TranscriptItem } from '../../../../admin/conversations/types';

const HOUR_MS = 60 * 60 * 1000;
const MAX_EVENTS = 500;

// Only the fields the transcript shows. The time bounds keep the lookup on the events table's
// date-first sort key; they come from the session's own start and end in the summary.
const TRANSCRIPT_SQL = `
SELECT
  event,
  timestamp,
  toString(properties.run_id) AS run_id,
  toString(properties.current_page) AS current_page,
  toString(properties.user_message) AS user_message,
  toString(properties.bot_response) AS bot_response,
  toString(properties.function_call_name) AS function_call_name,
  toString(properties.function_call_args) AS function_call_args,
  toString(properties.server_tools) AS server_tools,
  toString(properties.lane) AS lane,
  toString(properties.model) AS model,
  toString(properties.model_failure) AS model_failure,
  toString(properties.pipeline_error) AS pipeline_error,
  toFloat(properties.grounding_score) AS grounding_score,
  toFloat(properties.makes_claims_probability) AS makes_claims,
  toFloat(properties.admits_miss_probability) AS admits_miss,
  toFloat(properties.speaks_as_hunter_probability) AS speaks_as_hunter,
  toString(properties.suggestion_text) AS suggestion_text,
  toString(properties.suggestions) AS suggestions
FROM events
WHERE timestamp >= parseDateTimeBestEffort({windowStart})
  AND timestamp <= parseDateTimeBestEffort({windowEnd})
  AND event IN ('chat_message', 'rag_grounding', 'suggestion_clicked', 'suggestions_shown')
  AND coalesce(nullIf(toString(properties.session_id), ''), distinct_id) = {sessionId}
ORDER BY timestamp DESC
LIMIT ${MAX_EVENTS + 1}
`;

type Row = Record<string, unknown>;

function parseList(v: unknown): string[] {
	const raw = str(v);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

/** The model SDK sometimes serialised a function call into bot_response as raw JSON. */
function resolveCall(row: Row): {
	fnName: string | null;
	fnArgs: string | null;
	text: string | null;
} {
	const name = str(row.function_call_name);
	if (name) return { fnName: name, fnArgs: str(row.function_call_args), text: null };
	const response = str(row.bot_response);
	if (response) {
		try {
			const parsed = JSON.parse(response);
			if (parsed?.function_call?.name) {
				const args = parsed.function_call.arguments;
				return {
					fnName: parsed.function_call.name,
					fnArgs: typeof args === 'string' ? args : args ? JSON.stringify(args) : null,
					text: null
				};
			}
		} catch {
			/* plain text */
		}
	}
	return { fnName: null, fnArgs: null, text: response };
}

export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const user = authenticateUser(cookies);
	if (!user || user.role !== UserRole.ADMIN) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const from = Date.parse(url.searchParams.get('from') ?? '');
	const to = Date.parse(url.searchParams.get('to') ?? '');
	if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
		return json({ error: 'from and to must be ISO timestamps' }, { status: 400 });
	}

	try {
		const found = await runHogQL<Row>(TRANSCRIPT_SQL, {
			windowStart: new Date(from - HOUR_MS).toISOString(),
			windowEnd: new Date(to + HOUR_MS).toISOString(),
			sessionId: params.sessionId
		});
		if (found === null) {
			return json({ error: 'PostHog is not configured', items: [] }, { status: 503 });
		}

		// Fetched newest first with one spare row: a spare means older events were cut off
		const truncated = found.length > MAX_EVENTS;
		const rows = found.slice(0, MAX_EVENTS).reverse();

		// Grounding arrives as its own event after the reply; attach it to its turn by run_id.
		const grounding = new Map<string, Row>();
		for (const r of rows) {
			if (r.event === 'rag_grounding' && str(r.run_id)) grounding.set(String(r.run_id), r);
		}

		const items: TranscriptItem[] = [];
		for (const r of rows) {
			const timestamp = String(r.timestamp);
			if (r.event === 'chat_message') {
				const call = resolveCall(r);
				const g = grounding.get(String(r.run_id));
				items.push({
					type: 'chat_message',
					timestamp,
					currentPage: str(r.current_page),
					userMessage: str(r.user_message),
					botResponse: call.text,
					fnName: call.fnName,
					fnArgs: call.fnArgs,
					serverTools: parseList(r.server_tools),
					lane: str(r.lane),
					model: str(r.model),
					modelFailure:
						str(r.model_failure) ?? (str(r.pipeline_error) === 'true' ? 'pipeline_error' : null),
					// Only replies that make claims have a meaningful score
					grounding: g && (num(g.makes_claims) ?? 0) > 0.5 ? num(g.grounding_score) : null,
					admitsMiss: g ? (num(g.admits_miss) ?? 0) > 0.5 : false,
					spokeAsHunter: g ? (num(g.speaks_as_hunter) ?? 0) > 0.5 : false
				});
			} else if (r.event === 'suggestions_shown') {
				items.push({ type: 'suggestions_shown', timestamp, suggestions: parseList(r.suggestions) });
			} else if (r.event === 'suggestion_clicked') {
				items.push({ type: 'suggestion_clicked', timestamp, text: str(r.suggestion_text) });
			}
		}

		return json({ items, truncated }, { headers: { 'Cache-Control': 'private, no-store' } });
	} catch (err) {
		console.error('Transcript fetch failed:', err);
		return json({ error: String(err), items: [] }, { status: 502 });
	}
};
