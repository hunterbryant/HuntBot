/** Split a sentence into per-word parts with trailing spaces */
export type Word = { text: string; class?: string };

export function toWords(sentence: string): Word[] {
	const words = sentence.split(' ');
	return words.map((w, i) => ({ text: i < words.length - 1 ? w + ' ' : w }));
}

/** Phrases used for rotating hero treatments (GPU headline, etc.) */
export const HERO_CYCLING_PHRASES: string[] = [
	"Let's build the product your users actually want",
	"Let's find the problem worth solving",
	"Let's design what the data is telling us",
	"Let's build what your research reveals",
	"Let's ship the product that feels inevitable",
	"Let's craft the experience your users deserve",
	"Let's make the interface disappear",
	"Let's take your product from vision to market",
	"Let's design the product that earns its place",
	"Let's build something your users don't outgrow",
	"Let's design for the world your users move through",
	"Let's build products that meet people where they are"
];

export const STAGGER_SEC = 0.12;
export const WORD_DURATION = 0.8;
export const MAX_WORDS = 12;
export const CYCLE_INTERVAL_MS = 14000;

/** Word grids for each cycling phrase */
export const HERO_PHRASE_WORDS: Word[][] = HERO_CYCLING_PHRASES.map(toWords);

/**
 * Pseudo-random shuffle (Fisher–Yates). First index is always 0 so the primary
 * phrase leads; remaining indices are shuffled. Pass `random` for tests.
 */
export function shuffledOrder(random: () => number = Math.random): number[] {
	const rest = Array.from({ length: HERO_CYCLING_PHRASES.length - 1 }, (_, i) => i + 1);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[rest[i], rest[j]] = [rest[j]!, rest[i]!];
	}
	return [0, ...rest];
}

/** Static home H1: plain / italic segments (matches default Prismic hero copy) */
export type HeadlineSegment = { text: string; italic?: boolean };

export const PRIMARY_HERO_HEADLINE_SEGMENTS: readonly HeadlineSegment[] = [
	{ text: "Let's build the product your users " },
	{ text: 'actually', italic: true },
	{ text: ' want' }
] as const;
