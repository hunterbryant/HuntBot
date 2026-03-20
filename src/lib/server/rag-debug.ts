import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/** Server-side RAG / agent loop logging (dev or RAG_DEBUG=1). */
export function shouldLogRag(): boolean {
	if (dev) return true;
	return env.RAG_DEBUG === '1';
}

export function logRag(message: string, data?: Record<string, unknown>): void {
	if (!shouldLogRag()) return;
	if (data && Object.keys(data).length > 0) {
		console.log(`[HuntBot RAG] ${message}`, data);
	} else {
		console.log(`[HuntBot RAG] ${message}`);
	}
}
