import type { UIMessage } from '@ai-sdk/svelte';
import { describe, expect, it } from 'vitest';
import {
	getMessageText,
	partLooksLikeToolInvocation,
	streamingAssistantHasText,
	stripTrailingAssistantToolTurns
} from './messageUtils';

function msg(partial: Partial<UIMessage> & Pick<UIMessage, 'id' | 'role' | 'parts'>): UIMessage {
	return partial as UIMessage;
}

describe('getMessageText', () => {
	it('joins text parts', () => {
		const m = msg({
			id: '1',
			role: 'assistant',
			parts: [
				{ type: 'text', text: 'a' },
				{ type: 'text', text: 'b' }
			]
		});
		expect(getMessageText(m)).toBe('ab');
	});

	it('ignores non-text parts', () => {
		const m = msg({
			id: '1',
			role: 'assistant',
			parts: [{ type: 'text', text: 'x' }, { type: 'tool-invocation', toolCallId: 't' } as never]
		});
		expect(getMessageText(m)).toBe('x');
	});
});

describe('streamingAssistantHasText', () => {
	it('is false when only user messages', () => {
		const messages = [msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] })];
		expect(streamingAssistantHasText(messages)).toBe(false);
	});

	it('is true for assistant text after last user', () => {
		const messages = [
			msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }),
			msg({ id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] })
		];
		expect(streamingAssistantHasText(messages)).toBe(true);
	});

	it('ignores assistant text before last user', () => {
		const messages = [
			msg({ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'old' }] }),
			msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'new turn' }] }),
			msg({ id: 'a2', role: 'assistant', parts: [{ type: 'text', text: '' }] })
		];
		expect(streamingAssistantHasText(messages)).toBe(false);
	});
});

describe('partLooksLikeToolInvocation', () => {
	it('detects legacy and v6 tool part types', () => {
		expect(partLooksLikeToolInvocation({ type: 'tool-invocation' })).toBe(true);
		expect(partLooksLikeToolInvocation({ type: 'dynamic-tool' })).toBe(true);
		expect(partLooksLikeToolInvocation({ type: 'tool-minimize_chat' })).toBe(true);
		expect(partLooksLikeToolInvocation({ type: 'text' })).toBe(false);
	});
});

describe('stripTrailingAssistantToolTurns', () => {
	it('pops trailing assistant rows that only have tool parts', () => {
		const toolAssistant = msg({
			id: 't',
			role: 'assistant',
			parts: [{ type: 'tool-route_to_page', toolCallId: '1' } as never]
		});
		const textAssistant = msg({
			id: 'a',
			role: 'assistant',
			parts: [{ type: 'text', text: 'done' }]
		});
		const user = msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }] });
		const out = stripTrailingAssistantToolTurns([user, textAssistant, toolAssistant]);
		expect(out).toEqual([user, textAssistant]);
	});

	it('strips assistant that mixes text and tool parts (any tool part counts)', () => {
		const a = msg({
			id: 'a',
			role: 'assistant',
			parts: [{ type: 'text', text: 'here' }, { type: 'tool-x', toolCallId: '1' } as never]
		});
		const user = msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }] });
		expect(stripTrailingAssistantToolTurns([user, a])).toEqual([user]);
	});

	it('keeps trailing assistant when there are no tool parts', () => {
		const a = msg({
			id: 'a',
			role: 'assistant',
			parts: [{ type: 'text', text: 'only text' }]
		});
		const user = msg({ id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }] });
		expect(stripTrailingAssistantToolTurns([user, a])).toEqual([user, a]);
	});
});
