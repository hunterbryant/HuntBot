import { env } from '$env/dynamic/private';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { json, type RequestHandler } from '@sveltejs/kit';

const suggestionsSchema = z.object({
	suggestions: z
		.array(z.string())
		.length(3)
		.describe('Three short, playful status suggestions')
});

export const POST: RequestHandler = async ({ request }) => {
	const { input } = await request.json();
	if (!input || typeof input !== 'string') {
		return json({ suggestions: [] }, { status: 400 });
	}

	const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

	const { object } = await generateObject({
		model: openai('gpt-4o-mini'),
		schema: suggestionsSchema,
		prompt: `Generate 3 short, playful, lowercase status texts for a product designer's personal portfolio website. The designer wants to share what they're currently up to.

Input from the designer: "${input}"

Rules:
- Each status should be under 50 characters
- Use lowercase only, no period at the end
- Be creative and fun — think casual, witty, human
- Format like "currently [doing something fun] in [place]" or similar casual vibes
- Vary the structure across the 3 options — don't start all with "currently"
- Reference the specific activity/location from the input but make it more colorful`
	});

	return json({ suggestions: object.suggestions });
};
