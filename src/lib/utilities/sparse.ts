// ~100 common English stopwords
const STOPWORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
	'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
	'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
	'should', 'may', 'might', 'shall', 'can', 'it', 'its', 'this', 'that',
	'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him',
	'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'what', 'which',
	'who', 'how', 'when', 'where', 'not', 'no', 'as', 'if', 'so', 'up',
	'out', 'about', 'into', 'then', 'than', 'also', 'just', 'more', 'very'
]);

// Index space 2^17 = 131072 — keeps vectors compact while minimising collisions
const INDEX_MOD = 131072;

function fnv1a(str: string): number {
	let hash = 2166136261;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash % INDEX_MOD;
}

export function generateSparseVector(text: string): { indices: number[]; values: number[] } {
	const tokens = text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));

	if (tokens.length === 0) return { indices: [], values: [] };

	const freqs = new Map<number, number>();
	for (const token of tokens) {
		const idx = fnv1a(token);
		freqs.set(idx, (freqs.get(idx) ?? 0) + 1);
	}

	// Normalize by doc length so short and long docs score comparably
	const total = tokens.length;
	const entries = [...freqs.entries()].sort((a, b) => a[0] - b[0]);

	return {
		indices: entries.map((e) => e[0]),
		values: entries.map((e) => e[1] / total)
	};
}
