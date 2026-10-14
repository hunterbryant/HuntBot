import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { logRag } from '$lib/server/rag-debug';

const BROWSE_PAGES = new Set(['/', '/case-studies', '/projects', '/information']);

/**
 * Generate a hypothetical answer (HyDE) to improve vector retrieval.
 * The expanded text contains words that actually appear in stored chunks,
 * improving embedding similarity for vague queries.
 */
async function hydeExpand(query: string): Promise<string> {
	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

	try {
		const { text } = await generateText({
			model: openai('gpt-6-luna'),
			maxOutputTokens: 400, // includes reasoning tokens
			reasoning: 'low',
			// AI SDK 7 turns on detailed reasoning summaries whenever reasoning is set — not needed here.
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Write a brief 2-3 sentence answer to this question as if you were a portfolio website for a product designer named Hunter Bryant. Be specific with names, projects, and details. Output ONLY the answer, nothing else.

Question: "${query}"`
		});

		const expanded = text.trim();
		if (expanded.length < 10) {
			logRag('hyde expansion skipped (too short)', { original: query, expanded });
			return query;
		}

		const result = `${query} ${expanded}`;
		logRag('hyde expansion', { original: query.slice(0, 200), expanded: expanded.slice(0, 200) });
		return result;
	} catch (err) {
		logRag('hyde expansion failed', { error: String(err) });
		return query;
	}
}

const rewriteWithHydeSchema = z.object({
	query: z.string().describe('The follow-up rewritten as a standalone search query'),
	hypothetical_answer: z
		.string()
		.describe(
			"A brief 2-3 sentence answer to the standalone query, written as Hunter Bryant's portfolio site would answer it"
		)
});

/**
 * Rewrite the latest user message into a standalone retrieval query (multi-turn).
 * First message: run HyDE expansion; no multi-turn rewrite needed.
 * Follow-up messages: rewrite for context and write the HyDE answer in a single structured
 * call (these used to be two serial LLM calls, 5–6s together on the preview).
 * Pass `hyde: false` to skip HyDE (quick lane) — follow-ups then only get the rewrite.
 */
export async function rewriteRetrievalQuery(
	currentMessage: string,
	priorUserMessages: string[],
	currentPage: string,
	{ hyde = true }: { hyde?: boolean } = {}
): Promise<string> {
	const expand = (query: string) => (hyde ? hydeExpand(query) : Promise.resolve(query));

	if (priorUserMessages.length === 0) {
		let base = currentMessage;
		if (currentPage && !BROWSE_PAGES.has(currentPage)) {
			const slug = currentPage.split('/').pop();
			if (slug) base = `${currentMessage} ${slug}`;
		}
		return expand(base);
	}

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const pageHint = !BROWSE_PAGES.has(currentPage)
		? `The user is currently viewing: ${currentPage}`
		: '';
	const recent = priorUserMessages.slice(-3);

	const history = `${pageHint}

Conversation history:
${recent.map((m, i) => `User ${i + 1}: ${m}`).join('\n')}

Follow-up: "${currentMessage}"`;

	if (hyde) {
		try {
			const { output } = await generateText({
				model: openai('gpt-6-luna'),
				output: Output.object({ schema: rewriteWithHydeSchema }),
				maxOutputTokens: 600, // includes reasoning tokens
				reasoning: 'low',
				// AI SDK 7 turns on detailed reasoning summaries whenever reasoning is set — not needed here.
				providerOptions: { openai: { reasoningSummary: null } },
				prompt: `Do two things for this chat with a visitor to product designer Hunter Bryant's portfolio site.

1. query: Rewrite the follow-up message into a standalone search query that captures the full intent. Include any names, topics, or specifics from the conversation that the follow-up refers to.
2. hypothetical_answer: Write a brief 2-3 sentence answer to that query as if you were Hunter's portfolio website. Be specific with names, projects, and details — this text is only used to improve vector search, never shown to the visitor.

${history}`
			});

			const query = output.query.trim() || currentMessage;
			const hypothetical = output.hypothetical_answer.trim();
			logRag('rewrite + hyde', {
				query: query.slice(0, 200),
				expanded: hypothetical.slice(0, 200)
			});
			return hypothetical.length >= 10 ? `${query} ${hypothetical}` : query;
		} catch (err) {
			logRag('rewrite + hyde failed', { error: String(err) });
			return currentMessage;
		}
	}

	let rewritten = currentMessage;
	try {
		const { text } = await generateText({
			model: openai('gpt-6-luna'),
			maxOutputTokens: 400, // includes reasoning tokens
			reasoning: 'low',
			// AI SDK 7 turns on detailed reasoning summaries whenever reasoning is set — not needed here.
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `Rewrite the follow-up message into a standalone search query that captures the full intent. Include any names, topics, or specifics from the conversation that the follow-up refers to. Output ONLY the rewritten query, nothing else.

${history}`
		});
		rewritten = text.trim() || currentMessage;
	} catch {
		// keep original message
	}

	return rewritten;
}
