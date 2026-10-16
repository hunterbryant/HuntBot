import { env } from '$env/dynamic/private';
import { logRag } from '$lib/server/rag-debug';
import { createCohere } from '@ai-sdk/cohere';
import { createOpenAI } from '@ai-sdk/openai';
import type { Document } from '@langchain/core/documents';
import { experimental_decide, rerank, type Experimental_DecisionQuestion } from 'ai';

// Dedicated cross-encoder reranker — ~0.2–0.6s per call vs. seconds for an LLM-based rerank.
const COHERE_RERANK_MODEL = 'rerank-v4.0-fast';
const COHERE_TIMEOUT_MS = 3000;
// The Decisions call sits on the critical path of every standard/deep turn, so a slow call has
// to fail over to vector order like any other error instead of holding up the reply.
const DECISIONS_TIMEOUT_MS = 4000;

// Ordered rubric for each chunk's relevance. The Decisions API returns a probability-weighted
// fractional score in [0, RELEVANCE_LEVELS.length - 1], which ranks far more finely than an
// integer 1–5 rating and doesn't need a free-form structured-output generation.
const RELEVANCE_LEVELS = [
	'Irrelevant to the question',
	'Tangentially related',
	'Partially answers the question',
	'Directly answers the question'
];

// Excerpts go into the decision state once and every question refers to them by id. Site and
// notes chunks are embedded at 1000 chars, so this is the whole chunk: the sufficiency question
// below can't judge an answer it can't see (iMessage chunks are longer and get trimmed).
const DECISION_EXCERPT_CHARS = 1200;
// Earlier visitor messages shown to the sufficiency question, so follow-ups ("what about
// the second one?") can be judged against what they refer to.
const SUFFICIENCY_HISTORY_TURNS = 3;

type Ranked = { index: number; score: number };

/** What the visitor actually asked, for judging whether the candidates answer it. */
export type SufficiencyInput = {
	message: string;
	earlierMessages: string[];
};

export type RerankEngine = 'cohere' | 'decisions' | 'none';

export type RerankResult = {
	docs: Document[];
	/** Which reranker ran; 'none' when there were too few candidates to rerank. */
	engine: RerankEngine;
	/** The reranker errored and the incoming vector-score order was used instead. */
	failed: boolean;
	/** Decisions call input tokens, for cost tracking (null for Cohere / no call). */
	inputTokens: number | null;
	/**
	 * Decisions engine only: probability that the candidate excerpts, taken together, answer
	 * the visitor's message. Null when nothing judged it (Cohere, no rerank call, or failure),
	 * in which case callers fall back to their own heuristics.
	 */
	answersQuestion: number | null;
};

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
 * answered in a single call. Used when no Cohere key is configured. When `sufficiency` is
 * given, the same call also answers whether the candidates cover the visitor's message, which
 * the chat endpoint uses instead of its chunk-count heuristic to decide on the router.
 */
async function rankWithDecisions(
	query: string,
	docs: Document[],
	topK: number,
	sufficiency?: SufficiencyInput
): Promise<{ ranked: Ranked[]; answersQuestion: number | null; inputTokens: number | null }> {
	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

	const excerpts = docs.map((doc, i) => ({
		id: `chunk_${i}`,
		source: String(doc.metadata?.source ?? 'unknown'),
		text: doc.pageContent.slice(0, DECISION_EXCERPT_CHARS)
	}));

	const questions: Record<string, Experimental_DecisionQuestion> = {};
	for (const excerpt of excerpts) {
		questions[excerpt.id] = {
			type: 'score',
			instructions: `How relevant is excerpt ${excerpt.id} to the question?`,
			criteria: RELEVANCE_LEVELS
		};
	}
	if (sufficiency) {
		questions.answers_question = {
			type: 'boolean',
			instructions:
				"Taken together, do the excerpts contain what's needed to answer visitor_message (read in light of earlier_visitor_messages)? Judge only what the excerpts actually say.",
			criteria: {
				true: 'The excerpts directly state the facts the visitor asked about.',
				false:
					'The excerpts are off-topic or only tangential, or they miss the specific person, project, date or detail the visitor asked about.'
			}
		};
	}

	const { answers, usage } = await experimental_decide({
		model: openai.decisionModel('gpt-6-luna'),
		state: {
			question: query,
			...(sufficiency && {
				visitor_message: sufficiency.message,
				earlier_visitor_messages: sufficiency.earlierMessages.slice(-SUFFICIENCY_HISTORY_TURNS)
			}),
			excerpts
		},
		questions,
		abortSignal: AbortSignal.timeout(DECISIONS_TIMEOUT_MS)
	});

	// Stable sort: ties keep their incoming (vector-score) order.
	const ranked = docs
		.map((_, index) => {
			const answer = answers[`chunk_${index}`];
			return { index, score: answer?.type === 'score' ? answer.score : 0 };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);

	const sufficient = answers.answers_question;
	return {
		ranked,
		answersQuestion: sufficient?.type === 'boolean' ? sufficient.probability : null,
		inputTokens: usage.inputTokens ?? null
	};
}

/**
 * Rerank over-retrieved chunks down to `topK`. Uses Cohere Rerank when `COHERE_API_KEY` is
 * set, otherwise OpenAI Decisions. Any failure falls back to the incoming vector-score order
 * so retrieval never breaks because a reranker is down. Pass `sufficiency` to also get the
 * Decisions engine's judgment of whether the candidates answer the visitor's message.
 */
export async function rerankChunks(
	query: string,
	docs: Document[],
	topK: number = 5,
	sufficiency?: SufficiencyInput
): Promise<RerankResult> {
	// Few enough candidates that there's nothing to rerank — and no call to piggyback on.
	if (docs.length <= topK) {
		return { docs, engine: 'none', failed: false, inputTokens: null, answersQuestion: null };
	}

	const cohereKey = env.COHERE_API_KEY;
	const engine: RerankEngine = cohereKey ? 'cohere' : 'decisions';

	try {
		const { ranked, answersQuestion, inputTokens } = cohereKey
			? {
					ranked: await rankWithCohere(query, docs, topK, cohereKey),
					answersQuestion: null,
					inputTokens: null
				}
			: await rankWithDecisions(query, docs, topK, sufficiency);

		logRag('rerank results', {
			engine,
			inputCount: docs.length,
			outputCount: ranked.length,
			scores: ranked.map((r) => ({ idx: r.index, score: Number(r.score.toFixed(3)) })),
			answersQuestion,
			inputTokens
		});

		return {
			docs: ranked.filter((r) => r.index >= 0 && r.index < docs.length).map((r) => docs[r.index]),
			engine,
			failed: false,
			inputTokens,
			answersQuestion
		};
	} catch (err) {
		console.warn(`Reranking (${engine}) failed, returning original order:`, err);
		return {
			docs: docs.slice(0, topK),
			engine,
			failed: true,
			inputTokens: null,
			answersQuestion: null
		};
	}
}
