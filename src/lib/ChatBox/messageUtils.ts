import type { UIMessage } from '@ai-sdk/svelte';

export function getMessageText(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

/** True once the in-flight assistant reply has any visible text (hides loading placeholder while still streaming). */
export function streamingAssistantHasText(messages: UIMessage[]): boolean {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			lastUserIdx = i;
			break;
		}
	}
	for (let i = lastUserIdx + 1; i < messages.length; i++) {
		const m = messages[i];
		if (m.role === 'assistant' && getMessageText(m).trim()) return true;
	}
	return false;
}

/** True for UI tool parts in AI SDK v6 (`tool-*`, `dynamic-tool`) and legacy `tool-invocation`. */
export function partLooksLikeToolInvocation(p: { type: string }): boolean {
	return (
		p.type === 'tool-invocation' ||
		p.type === 'dynamic-tool' ||
		(typeof p.type === 'string' && p.type.startsWith('tool-'))
	);
}

/**
 * Remove trailing assistant rows that still contain tool-call UI parts.
 * Client-side tools are handled by replacing the turn with synthetic messages (no addToolOutput).
 * Leaving SDK tool rows in history sends dangling tool_calls to the model without tool results,
 * which often yields empty assistant text on the next turn (spinner stops, no bubble).
 */
export function stripTrailingAssistantToolTurns(messages: UIMessage[]): UIMessage[] {
	const out = [...messages];
	while (out.length > 0) {
		const last = out[out.length - 1];
		if (last.role !== 'assistant') break;
		const hasToolPart = last.parts.some((p) => partLooksLikeToolInvocation(p));
		if (!hasToolPart) break;
		out.pop();
	}
	return out;
}
