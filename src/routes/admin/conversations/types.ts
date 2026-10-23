/** One row of the conversations list: a session summarised by the summary route. */
export interface ConversationSummary {
	sessionId: string;
	startedAt: string;
	lastActiveAt: string;
	durationMs: number;
	msgCount: number;
	userMsgCount: number;
	suggestionClickCount: number;
	contactClicks: number;
	notHelpfulCount: number;
	opened: boolean;
	firstQuestion: string | null;
	navDest: string | null;
	hasNavigation: boolean;
	org: string | null;
	orgSource: string | null;
	isAdmin: boolean;
	/** Eval and verification sessions, which aren't real visitors. */
	isTest: boolean;
	pages: string[];
	/** Lowest grounding score (0–3) among replies that made claims, or null if none were scored. */
	minGrounding: number | null;
	misses: number;
	spokeAsHunter: number;
	failures: number;
	meta: UserMeta;
}

export interface UserMeta {
	city: string | null;
	region: string | null;
	country: string | null;
	timezone: string | null;
	ip: string | null;
	lat: number | null;
	lon: number | null;
	arrivedVia: string | null;
	gpc: boolean;
}

export type TranscriptItem =
	| {
			type: 'chat_message';
			timestamp: string;
			currentPage: string | null;
			userMessage: string | null;
			botResponse: string | null;
			fnName: string | null;
			fnArgs: string | null;
			serverTools: string[];
			lane: string | null;
			model: string | null;
			modelFailure: string | null;
			grounding: number | null;
			admitsMiss: boolean;
			spokeAsHunter: boolean;
	  }
	| { type: 'suggestions_shown'; timestamp: string; suggestions: string[] }
	| { type: 'suggestion_clicked'; timestamp: string; text: string | null };

/** Grounding below this (on the 0–3 scale) is flagged as poorly supported. */
export const LOW_GROUNDING = 1;

/** Sessions worth a look. Misses ("I don't know") are common, so they badge a row but don't count. */
export function needsAttention(c: ConversationSummary): boolean {
	return (
		c.failures > 0 ||
		c.notHelpfulCount > 0 ||
		c.spokeAsHunter > 0 ||
		(c.minGrounding !== null && c.minGrounding < LOW_GROUNDING)
	);
}

export function attentionScore(c: ConversationSummary): number {
	return (
		(c.failures ? 1000 : 0) +
		(c.notHelpfulCount ? 500 : 0) +
		(c.minGrounding !== null && c.minGrounding < LOW_GROUNDING
			? 100 + (LOW_GROUNDING - c.minGrounding) * 10
			: 0) +
		c.misses +
		c.spokeAsHunter
	);
}
