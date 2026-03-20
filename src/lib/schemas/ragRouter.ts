import { z } from 'zod';

/**
 * Pre-turn plan: extra vector searches before the main agent runs.
 * Empty `supplemental_searches` means initial CONTEXT is enough.
 */
export const ragRouterSchema = z.object({
	supplemental_searches: z
		.array(
			z.object({
				query: z
					.string()
					.min(1)
					.max(500)
					.describe('Focused search query — entities, topics, or rephrasings not well covered below.'),
				source_filter: z
					.enum(['all', 'imessage', 'site'])
					.describe(
						'imessage: personal life, texts, friends, plans. site: portfolio, case studies, work on hunterbryant.io. all: unclear or cross-source.'
					)
			})
		)
		.max(3)
		.describe(
			'Zero entries if CONTEXT already has enough to answer well. Otherwise 1–3 targeted searches — do not repeat what CONTEXT already contains.'
		),
	assistant_hint: z
		.string()
		.max(300)
		.optional()
		.describe(
			'Optional one-line note for the reply model (e.g. which section to trust). Not shown to the visitor.'
		)
});

export type RagRouterPlan = z.infer<typeof ragRouterSchema>;
