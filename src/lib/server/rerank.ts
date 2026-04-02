import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, zodSchema } from 'ai';
import { z } from 'zod';
import { logRag } from '$lib/server/rag-debug';
import type { Document } from '@langchain/core/documents';

const rerankSchema = z.object({
	rankings: z.array(
		z.object({
			index: z.number().describe('Zero-based index of the chunk'),
			relevance: z
				.number()
				.min(1)
				.max(5)
				.describe('1=irrelevant, 5=directly answers the question')
		})
	)
});

export async function rerankChunks(
	query: string,
	docs: Document[],
	topK: number = 5
): Promise<Document[]> {
	if (docs.length <= topK) return docs;

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

	const chunkSummaries = docs
		.map((doc, i) => {
			const source = doc.metadata?.source ?? 'unknown';
			const preview = doc.pageContent.slice(0, 300);
			return `[${i}] (${source}) ${preview}`;
		})
		.join('\n\n');

	try {
		const { object } = await generateObject({
			model: openai('gpt-4.1-mini'),
			schema: zodSchema(rerankSchema),
			temperature: 0,
			prompt: `Rate how relevant each chunk is to the question. Score 1-5 (1=irrelevant, 5=directly answers).

Question: "${query}"

Chunks:
${chunkSummaries}`
		});

		const sorted = object.rankings
			.filter((r) => r.index >= 0 && r.index < docs.length)
			.sort((a, b) => b.relevance - a.relevance)
			.slice(0, topK);

		const result = sorted.map((r) => docs[r.index]);

		logRag('rerank results', {
			inputCount: docs.length,
			outputCount: result.length,
			scores: sorted.map((r) => ({ idx: r.index, score: r.relevance }))
		});

		return result;
	} catch (err) {
		console.warn('Reranking failed, returning original order:', err);
		return docs.slice(0, topK);
	}
}
