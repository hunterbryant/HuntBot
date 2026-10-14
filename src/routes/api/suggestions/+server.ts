import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages } = await request.json();

		const recentMessages = (messages as { role: string; content: string }[])
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.slice(-6)
			.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

		const { output } = await generateText({
			model: openai('gpt-6-luna'),
			reasoning: 'low',
			// Includes reasoning tokens, so leave headroom beyond the short output itself.
			maxOutputTokens: 400,
			providerOptions: { openai: { reasoningSummary: null } },
			output: Output.object({ schema: z.object({ questions: z.array(z.string()) }) }),
			instructions:
				'Based on this conversation about product designer Hunter Bryant, generate exactly 3 short follow-up questions the visitor might want to ask next. Each question should be 3–6 words, conversational, and specific to what was just discussed. Example: "What tools does he use?", "Can I see that project?", "How long did that take?"',
			messages: recentMessages
		});

		return json({ suggestions: output.questions.slice(0, 3) });
	} catch (err) {
		console.warn('Suggestions failed:', err);
		return json({ suggestions: [] });
	}
};
