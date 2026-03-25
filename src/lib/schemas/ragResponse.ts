import { z } from 'zod';

/**
 * Post-hoc reflection on the assistant reply vs retrieved context (analytics / PostHog).
 * Not shown to the visitor.
 */
export const ragReflectionSchema = z.object({
	thinking: z
		.string()
		.describe(
			'Step-by-step: what the context supports, what is missing, and whether the assistant reply stayed grounded.'
		),
	citations: z
		.array(
			z.object({
				chunkId: z.string().describe('Chunk id from CONTEXT, e.g. CHUNK-site-...'),
				quote: z
					.string()
					.describe('Short quote or paraphrase from that chunk supporting a claim in the reply.')
			})
		)
		.describe(
			'Chunks that substantiate the assistant reply. Empty if reply is non-factual or context was empty.'
		),
	confidence: z
		.enum(['high', 'medium', 'low', 'insufficient_context'])
		.describe('How well CONTEXT supported the assistant reply.')
});

export type RagReflection = z.infer<typeof ragReflectionSchema>;

/** Alias for docs / specs that refer to “rag response” schema. */
export const ragResponseSchema = ragReflectionSchema;
export type RAGResponse = RagReflection;
