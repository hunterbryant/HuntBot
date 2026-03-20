import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const BROWSE_PAGES = new Set(['/', '/case-studies', '/projects', '/information']);

/**
 * Rewrite the latest user message into a standalone retrieval query (multi-turn).
 * First message: append page slug when on a specific URL; no LLM call.
 */
export async function rewriteRetrievalQuery(
	currentMessage: string,
	priorUserMessages: string[],
	currentPage: string
): Promise<string> {
	if (priorUserMessages.length === 0) {
		if (currentPage && !BROWSE_PAGES.has(currentPage)) {
			const slug = currentPage.split('/').pop();
			return slug ? `${currentMessage} ${slug}` : currentMessage;
		}
		return currentMessage;
	}

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const pageHint = !BROWSE_PAGES.has(currentPage)
		? `The user is currently viewing: ${currentPage}`
		: '';
	const recent = priorUserMessages.slice(-3);

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
		return text.trim() || currentMessage;
	} catch {
		return currentMessage;
	}
}
