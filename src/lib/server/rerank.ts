import { env } from '$env/dynamic/private';
import { logRag } from '$lib/server/rag-debug';
import { createCohere } from '@ai-sdk/cohere';
import { createOpenAI } from '@ai-sdk/openai';
import type { Document } from '@langchain/core/documents';
import { experimental_decide, rerank, type Experimental_DecisionQuestion } from 'ai';

// Dedicated cross-encoder reranker — ~0.2–0.6s per call vs. seconds for an LLM-based rerank.
const COHERE_RERANK_MODEL = 'rerank-v4.0-fast';
const COHERE_TIMEOUT_MS = 3000;

// Ordered rubric for each chunk's relevance. The Decisions API returns a probability-weighted
// fractional score in [0, RELEVANCE_LEVELS.length - 1], which ranks far more finely than an
// integer 1–5 rating and doesn't need a free-form structured-output generation.
const RELEVANCE_LEVELS = [
	'Irrelevant to the question',
	'Tangentially related',
	'Partially answers the question',
	'Directly answers the question'
];

const DECISION_PREVIEW_CHARS = 300;

type Ranked = { index: number; score: number };

/** Cohere Rerank via the AI SDK `rerank()` helper. Sees each chunk in full (they're ~1000 chars). */
async function rankWithCohere(
	query: string,
	docs: Document[],
	topK: number,
	apiKey: string
): Promise<Ranked[]> {
	const cohere = createCohere({ apiKey });
	const { ranking } = await rerank({
		model: cohere.reranking(COHERE_RERANK_MODEL),
		query,
		documents: docs.map((doc) => {
			const source = doc.metadata?.source ?? 'unknown';
			return `Source: ${source}\n${doc.pageContent}`;
		}),
		topN: topK,
		abortSignal: AbortSignal.timeout(COHERE_TIMEOUT_MS)
	});
	return ranking.map((r) => ({ index: r.originalIndex, score: r.score }));
}

/**
 * OpenAI Decisions API (AI SDK 7 `experimental_decide`): one Score question per chunk, all
 * answered in a single call. Used when no Cohere key is configured.
 */
async function rankWithDecisions(query: string, docs: Document[], topK: number): Promise<Ranked[]> {
	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

	const questions: Record<string, Experimental_DecisionQuestion> = {};
	docs.forEach((doc, i) => {
		const source = doc.metadata?.source ?? 'unknown';
		questions[`chunk_${i}`] = {
			type: 'score',
			instructions: `How relevant is this excerpt (source: ${source}) to the question?\n\n${doc.pageContent.slice(0, DECISION_PREVIEW_CHARS)}`,
			criteria: RELEVANCE_LEVELS
		};
	});

	const { answers } = await experimental_decide({
		model: openai.decisionModel('gpt-6-luna'),
		state: { question: query },
		questions
	});

	// Stable sort: ties keep their incoming (vector-score) order.
	return docs
		.map((_, index) => {
			const answer = answers[`chunk_${index}`];
			return { index, score: answer?.type === 'score' ? answer.score : 0 };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

/**
 * Rerank over-retrieved chunks down to `topK`. Uses Cohere Rerank when `COHERE_API_KEY` is
 * set, otherwise OpenAI Decisions. Any failure falls back to the incoming vector-score order
 * so retrieval never breaks because a reranker is down.
 */
export async function rerankChunks(
	query: string,
	docs: Document[],
	topK: number = 5
): Promise<Document[]> {
	if (docs.length <= topK) return docs;

	const cohereKey = env.COHERE_API_KEY;
	const engine = cohereKey ? 'cohere' : 'decisions';

	try {
		const ranked = cohereKey
			? await rankWithCohere(query, docs, topK, cohereKey)
			: await rankWithDecisions(query, docs, topK);

		logRag('rerank results', {
			engine,
			inputCount: docs.length,
			outputCount: ranked.length,
			scores: ranked.map((r) => ({ idx: r.index, score: Number(r.score.toFixed(3)) }))
		});

		return ranked.filter((r) => r.index >= 0 && r.index < docs.length).map((r) => docs[r.index]);
	} catch (err) {
		console.warn(`Reranking (${engine}) failed, returning original order:`, err);
		return docs.slice(0, topK);
	}
}
