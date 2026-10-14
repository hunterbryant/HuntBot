import { env } from '$env/dynamic/private';
import { logRag } from '$lib/server/rag-debug';
import { createOpenAI } from '@ai-sdk/openai';
import type { Document } from '@langchain/core/documents';
import { experimental_decide, type Experimental_DecisionQuestion } from 'ai';

// Ordered rubric for each chunk's relevance. The Decisions API returns a probability-weighted
// fractional score in [0, RELEVANCE_LEVELS.length - 1], which ranks far more finely than an
// integer 1–5 rating and doesn't need a free-form structured-output generation.
const RELEVANCE_LEVELS = [
	'Irrelevant to the question',
	'Tangentially related',
	'Partially answers the question',
	'Directly answers the question'
];

const CHUNK_PREVIEW_CHARS = 300;

/**
 * Rerank over-retrieved chunks with OpenAI's Decisions API (AI SDK 7 `experimental_decide`):
 * one Score question per chunk, all answered in a single call. Replaces a structured-output
 * LLM call that took several seconds per turn. Falls back to vector order on any failure —
 * the API is experimental, and a refusal or invalid answer fails the whole decision.
 */
export async function rerankChunks(
	query: string,
	docs: Document[],
	topK: number = 5
): Promise<Document[]> {
	if (docs.length <= topK) return docs;

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

	const questions: Record<string, Experimental_DecisionQuestion> = {};
	docs.forEach((doc, i) => {
		const source = doc.metadata?.source ?? 'unknown';
		questions[`chunk_${i}`] = {
			type: 'score',
			instructions: `How relevant is this excerpt (source: ${source}) to the question?\n\n${doc.pageContent.slice(0, CHUNK_PREVIEW_CHARS)}`,
			criteria: RELEVANCE_LEVELS
		};
	});

	try {
		const { answers } = await experimental_decide({
			model: openai.decisionModel('gpt-6-luna'),
			state: { question: query },
			questions
		});

		// Stable sort: ties keep their incoming (vector-score) order.
		const ranked = docs
			.map((doc, i) => {
				const answer = answers[`chunk_${i}`];
				const score = answer?.type === 'score' ? answer.score : 0;
				return { doc, i, score };
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		logRag('rerank results', {
			inputCount: docs.length,
			outputCount: ranked.length,
			scores: ranked.map((r) => ({ idx: r.i, score: Number(r.score.toFixed(3)) }))
		});

		return ranked.map((r) => r.doc);
	} catch (err) {
		console.warn('Reranking failed, returning original order:', err);
		return docs.slice(0, topK);
	}
}
