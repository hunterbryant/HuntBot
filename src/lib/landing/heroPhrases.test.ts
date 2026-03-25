import { describe, expect, it, vi } from 'vitest';
import {
	HERO_CYCLING_PHRASES,
	HERO_PHRASE_WORDS,
	MAX_WORDS,
	shuffledOrder,
	toWords
} from './heroPhrases';

describe('toWords', () => {
	it('keeps trailing space on all but last word', () => {
		expect(toWords('a b')).toEqual([{ text: 'a ' }, { text: 'b' }]);
	});

	it('handles single word', () => {
		expect(toWords('hello')).toEqual([{ text: 'hello' }]);
	});
});

describe('HERO_PHRASE_WORDS', () => {
	it('matches phrase count', () => {
		expect(HERO_PHRASE_WORDS.length).toBe(HERO_CYCLING_PHRASES.length);
	});

	it('first phrase word count within GPU max', () => {
		expect(HERO_PHRASE_WORDS[0]!.length).toBeLessThanOrEqual(MAX_WORDS);
	});
});

describe('shuffledOrder', () => {
	it('always starts with 0', () => {
		const order = shuffledOrder(() => 0.5);
		expect(order[0]).toBe(0);
		expect(order.length).toBe(HERO_CYCLING_PHRASES.length);
	});

	it('is deterministic with fixed random', () => {
		const rng = vi.fn().mockReturnValue(0);
		const a = shuffledOrder(rng);
		rng.mockReturnValue(0);
		const b = shuffledOrder(rng);
		expect(a).toEqual(b);
	});
});
