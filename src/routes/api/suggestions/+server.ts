import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages } = await request.json();

		const recentMessages = (messages as { role: string; content: string }[])
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.slice(-6)
			.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

		const response = await openai.chat.completions.create({
			model: 'gpt-4.1-mini',
			max_tokens: 100,
			messages: [
				{
					role: 'system',
					content:
						'Based on this conversation about product designer Hunter Bryant, generate exactly 3 short follow-up questions the visitor might want to ask next. Return only a JSON array of strings, nothing else. Each question should be 3–8 words, conversational, and specific to what was just discussed. Example: ["What tools does he use?", "Can I see that project?", "How long did that take?"]'
				},
				...recentMessages
			]
		});

		const content = response.choices[0]?.message?.content ?? '[]';
		let suggestions: string[] = [];
		try {
			suggestions = JSON.parse(content);
		} catch {
			suggestions = [];
		}

		return json({ suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 3) : [] });
	} catch {
		return json({ suggestions: [] });
	}
};
