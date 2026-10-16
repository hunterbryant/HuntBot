import { env } from '$env/dynamic/private';
import { ragReflectionSchema } from '$lib/schemas/ragResponse';
import { captureServerEvent } from '$lib/server/posthog';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, zodSchema } from 'ai';

const CONTEXT_EXCERPT_MAX = 12_000;

/**
 * Optional second-pass structured audit for PostHog (`RAG_REFLECTION=1`).
 * Does not change the user-visible reply.
 */
export async function sendRagReflectionToPosthog(options: {
	userMessage: string;
	assistantText: string;
	contextExcerpt: string;
	sessionId: string | null;
	runID: string;
	currentPage: string;
}): Promise<void> {
	if (env.RAG_REFLECTION !== '1') return;

	const { userMessage, assistantText, contextExcerpt, sessionId, runID, currentPage } = options;
	if (!assistantText?.trim()) return;

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
	const excerpt = contextExcerpt.slice(0, CONTEXT_EXCERPT_MAX);

	const { output: object } = await generateText({
		model: openai('gpt-6-luna'),
		output: Output.object({ schema: zodSchema(ragReflectionSchema) }),
		reasoning: 'low',
		providerOptions: { openai: { reasoningSummary: null } },
		prompt: `You are auditing a RAG assistant reply for grounding.

User message:
${userMessage}

Assistant reply (what the user saw):
${assistantText}

Retrieved CONTEXT (excerpt; chunks start with [CHUNK-...]):
${excerpt}

Fill the JSON schema: internal thinking about grounding, citations mapping claims to chunk ids, and confidence.`
	});

	await captureServerEvent('rag_reflection', sessionId ?? runID, {
		user_message: userMessage,
		rag_thinking: object.thinking,
		rag_citations: object.citations,
		rag_confidence: object.confidence,
		current_page: currentPage,
		run_id: runID,
		session_id: sessionId
	});
}
