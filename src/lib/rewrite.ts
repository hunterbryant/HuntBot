import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
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
			model: openai('gpt-4.1-mini'),
			temperature: 0,
			maxOutputTokens: 100,
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

/**
 * Rewrite the latest user message into a standalone retrieval query (multi-turn).
 * First message: run HyDE expansion; no multi-turn rewrite needed.
 * Follow-up messages: rewrite for context, then run HyDE on the result.
 */
export async function rewriteRetrievalQuery(
	currentMessage: string,
	priorUserMessages: string[],
	currentPage: string
): Promise<string> {
	if (priorUserMessages.length === 0) {
		let base = currentMessage;
		if (currentPage && !BROWSE_PAGES.has(currentPage)) {
			const slug = currentPage.split('/').pop();
			if (slug) base = `${currentMessage} ${slug}`;
		}
		return hydeExpand(base);
	}

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const pageHint = !BROWSE_PAGES.has(currentPage)
		? `The user is currently viewing: ${currentPage}`
		: '';
	const recent = priorUserMessages.slice(-3);

	let rewritten = currentMessage;
	try {
		const { text } = await generateText({
			model: openai('gpt-4.1-mini'),
			temperature: 0.2,
			maxOutputTokens: 150,
			prompt: `Rewrite the follow-up message into a standalone search query that captures the full intent. Include any names, topics, or specifics from the conversation that the follow-up refers to. Output ONLY the rewritten query, nothing else.

${pageHint}

Conversation history:
${recent.map((m, i) => `User ${i + 1}: ${m}`).join('\n')}

Follow-up: "${currentMessage}"`
		});
		rewritten = text.trim() || currentMessage;
	} catch {
		// keep original message
	}

	return hydeExpand(rewritten);
}
