import { describe, expect, it } from 'vitest';
import { ToolCallLeakGuard } from './tool-call-leak';

/** Streams `text` through a fresh guard in `size`-character deltas, the way the chat route does. */
function stream(text: string, size: number) {
	const guard = new ToolCallLeakGuard();
	let out = '';
	for (let i = 0; i < text.length; i += size) out += guard.push(text.slice(i, i + size));
	out += guard.flush();
	return { guard, out };
}

const SIZES = [1, 2, 3, 7, 24, 25, 50, 1000];

// The Oct 22 reply that reached a visitor, trimmed
const LEAKED =
	"There's relevant product-design work to discuss, but this isn't enough to call him a full match for the Staff scope.\n" +
	' to=functions.capture_lead_intent ابنcommentary "somedata" mente? \nWait valid JSON need. \n' +
	'{"intent_type":"hiring","message":"His Karoo work gives you concrete examples."}  ?\n' +
	'We need actual tool format.';
const LEAKED_SAFE =
	"There's relevant product-design work to discuss, but this isn't enough to call him a full match for the Staff scope.";

describe('ToolCallLeakGuard', () => {
	it.each(SIZES)('passes ordinary text through unchanged (%i-char deltas)', (size) => {
		const text =
			'Hunter led six months of discovery on Karoo 24, then turned it into a launch roadmap. ' +
			'He set into=motion a design system, and wrote a <|note|> about it.';
		const { guard, out } = stream(text, size);
		expect(out).toBe(text);
		expect(guard.tripped).toBe(false);
		expect(guard.leakedLeadIntent()).toBeNull();
	});

	it.each(SIZES)('cuts a leaked tool call and everything after it (%i-char deltas)', (size) => {
		const { guard, out } = stream(LEAKED, size);
		expect(out).toBe(LEAKED_SAFE);
		expect(guard.tripped).toBe(true);
		expect(guard.leakedLeadIntent()).toEqual({ intent_type: 'hiring' });
	});

	it.each(SIZES)('cuts at a channel token (%i-char deltas)', (size) => {
		const { guard, out } = stream('He shipped Karoo 24.<|channel|>commentary to=functions.x', size);
		expect(out).toBe('He shipped Karoo 24.');
		expect(guard.tripped).toBe(true);
	});

	it.each(SIZES)('cuts a leak at the very start of a part (%i-char deltas)', (size) => {
		const { guard, out } = stream('to=functions.capture_lead_intent {"message":"Hi"}', size);
		expect(out).toBe('');
		expect(guard.tripped).toBe(true);
		expect(guard.leakedLeadIntent()).toEqual({ intent_type: 'general' });
	});

	it('does not read a marker into the middle of a word split across sends', () => {
		// After the first push "…in" has been sent and the held-back tail starts at "to=functions."
		const text = 'x'.repeat(40) + 'into=functions.foo and more text after it to flush';
		const guard = new ToolCallLeakGuard();
		let out = guard.push(text.slice(0, 66));
		expect(out).toBe(text.slice(0, 42));
		out += guard.push(text.slice(66));
		out += guard.flush();
		expect(guard.tripped).toBe(false);
		expect(out).toBe(text);
	});

	it('names no client tool when the leaked call was a different one', () => {
		const { guard } = stream('Here you go. to=functions.navigate_to_page {"page":"/"}', 5);
		expect(guard.tripped).toBe(true);
		expect(guard.leakedLeadIntent()).toBeNull();
	});
});
