/**
 * What a failed model call means for the visitor:
 * - `unavailable`: won't fix itself (no credits / quota, bad key, no access, unknown model), so
 *   "try again" would fail the same way and the visitor is better sent to Hunter directly.
 * - `transient`: rate limit, timeout, provider 5xx; asking again may well work.
 */
export type ModelFailure = 'unavailable' | 'transient';

// OpenAI reports an empty balance as a 429, the same status as an ordinary rate limit, so the
// message and error code are what tell them apart.
const OUT_OF_BALANCE = /credit|quota|billing|insufficient|payment/i;

type ErrorLike = {
	statusCode?: number;
	status?: number;
	message?: string;
	code?: string;
	/** AI SDK RetryError: the error that ended the retries. */
	lastError?: unknown;
	/** The `openai` package puts the response body here. */
	error?: { code?: string };
	/** The AI SDK puts the parsed response body here. */
	data?: { error?: { code?: string } };
};

/** Works for AI SDK errors, the `openai` package's APIError, and RetryError wrappers. */
export function classifyModelFailure(error: unknown, depth = 0): ModelFailure {
	if (!error || typeof error !== 'object' || depth > 3) return 'transient';
	const e = error as ErrorLike;
	if (e.lastError) return classifyModelFailure(e.lastError, depth + 1);

	const status = e.statusCode ?? e.status;
	if (status === 401 || status === 402 || status === 403 || status === 404) return 'unavailable';

	if (status === 429) {
		const text = [e.message, e.code, e.error?.code, e.data?.error?.code].filter(Boolean).join(' ');
		if (OUT_OF_BALANCE.test(text)) return 'unavailable';
	}
	return 'transient';
}
