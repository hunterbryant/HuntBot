// One JSON log line per call of the "knowledge" tools (Notion, job matching, self docs) and the
// company-role lookup, in the same style as [HuntBot training]. Numbers and short labels only:
// never page text, posting text or anything a visitor typed.

export type ToolCallLog = {
	tool: 'query_notion' | 'match_job_description' | 'explain_huntbot' | 'company_roles';
	/** query_notion: which action ran (search / describe / query / read). */
	action?: string;
	outcome: string;
	ms: number;
	/** How many Notion pages, role listings, doc sections or evidence chunks came back. */
	results?: number;
	/** company_roles: where the roles came from. */
	source?: 'ats' | 'web' | 'cache' | 'none';
	/** match_job_description: requirements extracted from the posting, and how many had no evidence. */
	requirements?: number;
	gaps?: number;
	/** match_job_description: whether the posting came from pasted text or a link. */
	input?: 'text' | 'url';
	error?: string;
};

/**
 * Short, log-safe text for an error. Provider errors can echo part of an API key ("Incorrect API
 * key provided: sk-abc***xyz"), so anything key-shaped is cut out before it reaches the logs.
 */
export function describeError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\b(sk|pk|rk|key|token)[-_][A-Za-z0-9*_.-]{4,}/gi, '$1-…').slice(0, 200);
}

/** Logs one `[HuntBot tools]` line; warnings for anything that isn't `ok`. */
export function logToolCall(runId: string, call: ToolCallLog): void {
	const line = JSON.stringify({
		run_id: runId,
		tool: call.tool,
		action: call.action,
		outcome: call.outcome,
		ms: call.ms,
		results: call.results,
		source: call.source,
		requirements: call.requirements,
		gaps: call.gaps,
		input: call.input,
		error: call.error
	});
	if (call.outcome === 'ok' || call.outcome === 'empty') console.log('[HuntBot tools]', line);
	else console.warn('[HuntBot tools]', line);
}

/** PostHog `chat_message` properties for the turn's knowledge-tool calls; nothing when none ran. */
export function toolAnalyticsProps(calls: ToolCallLog[]): Record<string, unknown> {
	if (calls.length === 0) return {};
	const find = (tool: ToolCallLog['tool']) => calls.find((c) => c.tool === tool);
	const roles = find('company_roles');
	const jd = find('match_job_description');
	const notion = calls.filter((c) => c.tool === 'query_notion');
	const docs = find('explain_huntbot');
	return {
		tool_outcomes: calls.map((c) => `${c.tool}:${c.outcome}`),
		...(notion.length && {
			notion_calls: notion.length,
			notion_actions: notion.map((c) => c.action),
			notion_results: notion.reduce((n, c) => n + (c.results ?? 0), 0)
		}),
		...(docs && { self_docs_sections: docs.results ?? 0 }),
		...(roles && { roles_source: roles.source ?? 'none', roles_count: roles.results ?? 0 }),
		...(jd && { jd_requirements: jd.requirements ?? 0, jd_gaps: jd.gaps ?? 0, jd_input: jd.input })
	};
}
