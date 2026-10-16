import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { experimental_decide, type Experimental_DecisionQuestion } from 'ai';

// Runs beside the vector check on a background chip fetch, so a slow call just means no filter.
const TIMEOUT_MS = 3000;
// A chip is dropped when the Decisions API puts at least this probability on "already answered".
export const ANSWERED_THRESHOLD = 0.6;

export type AnsweredCheck = {
	/** Candidates the last reply (or an earlier visitor question) doesn't already answer. */
	kept: string[];
	/** Probability each checked candidate is already answered, for the log line. */
	probabilities: Record<string, number>;
};

/**
 * Drops follow-up chips whose answer the visitor just read. One OpenAI Decisions call asks a
 * boolean per candidate against the last reply, so the vector check (which actually favors
 * these, since a question about what the bot just said matches its own source chunk best)
 * isn't the only filter. Fails open: any error or timeout keeps every candidate.
 */
export async function dropAlreadyAnswered(
	candidates: string[],
	lastReply: string,
	earlierVisitorQuestions: string[]
): Promise<AnsweredCheck> {
	if (candidates.length === 0 || !lastReply.trim()) return { kept: candidates, probabilities: {} };

	const items = candidates.map((text, i) => ({ id: `candidate_${i}`, text }));
	const questions: Record<string, Experimental_DecisionQuestion> = {};
	for (const item of items) {
		questions[item.id] = {
			type: 'boolean',
			instructions: `Does last_reply, or an earlier visitor question, already answer ${item.id}? Judge only what they actually say.`,
			criteria: {
				true: 'The reply already states the answer, or the visitor already asked this.',
				false: 'The reply leaves this open: it only mentions the subject, or does not touch it.'
			}
		};
	}

	try {
		const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
		const { answers } = await experimental_decide({
			model: openai.decisionModel('gpt-6-luna'),
			state: {
				last_reply: lastReply.slice(0, 2000),
				earlier_visitor_questions: earlierVisitorQuestions.slice(-5),
				candidates: items
			},
			questions,
			abortSignal: AbortSignal.timeout(TIMEOUT_MS)
		});

		const probabilities: Record<string, number> = {};
		const kept = items
			.filter((item) => {
				const answer = answers[item.id];
				const p = answer?.type === 'boolean' ? answer.probability : 0;
				probabilities[item.text] = p;
				return p < ANSWERED_THRESHOLD;
			})
			.map((item) => item.text);
		return { kept, probabilities };
	} catch (err) {
		console.warn('Suggestion already-answered check failed:', err);
		return { kept: candidates, probabilities: {} };
	}
}
