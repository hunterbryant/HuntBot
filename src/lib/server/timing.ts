/**
 * Per-request stage timer for the chat pipeline. Collects millisecond durations per stage
 * so slow turns can be attributed to a specific step (rewrite, rerank, router, first token…)
 * instead of guessed at. Results are logged once per turn and attached to PostHog events.
 */
export type StageTimer = {
	timings: Record<string, number>;
	/** Run `fn` and record how long it took under `label`. */
	time<T>(label: string, fn: () => Promise<T>): Promise<T>;
	/** Record the elapsed time since the timer was created under `label`. */
	mark(label: string): void;
};

export function createStageTimer(): StageTimer {
	const start = performance.now();
	const timings: Record<string, number> = {};
	return {
		timings,
		async time(label, fn) {
			const t0 = performance.now();
			try {
				return await fn();
			} finally {
				timings[label] = Math.round(performance.now() - t0);
			}
		},
		mark(label) {
			timings[label] = Math.round(performance.now() - start);
		}
	};
}

/** No-op timer so callers outside the chat endpoint don't need to pass one. */
export const noopTimer: StageTimer = {
	timings: {},
	time: (_label, fn) => fn(),
	mark: () => {}
};
