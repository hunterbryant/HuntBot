import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages, currentPage } = await request.json();

		const hasUserMessages = messages.some((m: { role: string }) => m.role === 'user');

		const systemPrompt = hasUserMessages
			? `Generate 3–4 short follow-up question suggestions (under 8 words each) for a visitor chatting with HuntBot on Hunter Bryant's portfolio site.

Current page: ${currentPage}

Rules:
- Make them natural and specific to the conversation context
- No generic filler — each suggestion should feel useful
- Return ONLY a JSON array of strings, nothing else

Example: ["What was the biggest design challenge?", "Can I see the final product?"]`
			: `Generate 3–4 short starter question suggestions (under 8 words each) for a new visitor on Hunter Bryant's portfolio site.

Current page: ${currentPage}

Hunter is a senior product designer known for hardware/software products, cycling tech, and consumer apps.

Rules:
- Tailor to the current page context if not the home page
- Make them feel like genuine curiosity, not marketing prompts
- Return ONLY a JSON array of strings, nothing else

Example: ["What kind of projects does Hunter take on?", "Tell me about his design process"]`;

		const conversationContext = hasUserMessages
			? messages
					.filter((m: { role: string }) => m.role !== 'function')
					.slice(-6)
					.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
					.join('\n')
			: null;

		const response = await openai.chat.completions.create({
			model: 'gpt-4.1-mini',
			messages: [
				{ role: 'system', content: systemPrompt },
				...(conversationContext
					? [{ role: 'user' as const, content: conversationContext }]
					: [])
			],
			temperature: 0.7,
			max_tokens: 150
		});

		const raw = response.choices[0]?.message?.content ?? '[]';

		let suggestions: string[] = [];
		try {
			const match = raw.match(/\[[\s\S]*\]/);
			if (match) {
				suggestions = JSON.parse(match[0]);
			}
		} catch {
			suggestions = [];
		}

		suggestions = suggestions
			.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
			.slice(0, 4);

		return json({ suggestions });
	} catch {
		return json({ suggestions: [] });
	}
};
