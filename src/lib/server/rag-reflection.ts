import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, zodSchema } from 'ai';
import { ragReflectionSchema } from '$lib/schemas/ragResponse';

const CONTEXT_EXCERPT_MAX = 12_000;

/**
 * Optional second-pass structured audit for PostHog (`RAG_REFLECTION=1`).
 * Does not change the user-visible reply.
 */
export async function sendRagReflectionToPosthog(options: {
	posthogKey: string;
	userMessage: string;
	assistantText: string;
	contextExcerpt: string;
	sessionId: string | null;
	runID: string;
	currentPage: string;
}): Promise<void> {
	if (env.RAG_REFLECTION !== '1') return;

	const { posthogKey, userMessage, assistantText, contextExcerpt, sessionId, runID, currentPage } =
		options;
	if (!assistantText?.trim()) return;

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const excerpt = contextExcerpt.slice(0, CONTEXT_EXCERPT_MAX);

	const { object } = await generateObject({
		model: openai('gpt-4.1-mini'),
		schema: zodSchema(ragReflectionSchema),
		temperature: 0.2,
		prompt: `You are auditing a RAG assistant reply for grounding.

User message:
${userMessage}

Assistant reply (what the user saw):
${assistantText}

Retrieved CONTEXT (excerpt; chunks start with [CHUNK-...]):
${excerpt}

Fill the JSON schema: internal thinking about grounding, citations mapping claims to chunk ids, and confidence.`
	});

	await fetch('https://us.i.posthog.com/capture/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			api_key: posthogKey,
			event: 'rag_reflection',
			distinct_id: sessionId ?? runID,
			timestamp: new Date().toISOString(),
			properties: {
				user_message: userMessage,
				rag_thinking: object.thinking,
				rag_citations: object.citations,
				rag_confidence: object.confidence,
				current_page: currentPage,
				run_id: runID,
				session_id: sessionId
			}
		})
	}).catch(() => {
		/* swallow */
	});
}
