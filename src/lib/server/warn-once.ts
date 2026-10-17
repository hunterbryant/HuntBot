const warned = new Set<string>();

/**
 * Logs a warning once per warm instance for a given key. For setup problems (a missing
 * env var) that would otherwise repeat on every request and bury the log.
 */
export function warnOnce(key: string, message: string, data?: Record<string, unknown>): void {
	if (warned.has(key)) return;
	warned.add(key);
	console.warn(message, data ?? {});
}
