import { env } from '$env/dynamic/private';
import { compile } from 'html-to-text';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
const convertHtml = compile({ wordwrap: 130 });
const SITE_ORIGIN = 'https://www.hunterbryant.io';

async function fetchPageText(path: string): Promise<string | null> {
	try {
		const res = await fetch(`${SITE_ORIGIN}${path}`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		const html = await res.text();
		return convertHtml(html).slice(0, 6000);
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { currentPage } = await request.json();

		// Only fire on specific project/case study pages
		if (!currentPage || !currentPage.match(/^\/(case-studies|projects)\/.+/)) {
			return json({ message: null });
		}

		const pageText = await fetchPageText(currentPage);
		if (!pageText) {
			return json({ message: null });
		}

		const { text } = await generateText({
			model: openai('gpt-6-luna'),
			reasoning: 'low',
			// Includes reasoning tokens, so leave headroom beyond the short output itself.
			maxOutputTokens: 400,
			providerOptions: { openai: { reasoningSummary: null } },
			prompt: `You are HuntBot, an assistant on Hunter Bryant's portfolio. A visitor just arrived on a page. Write a single natural sentence (max 20 words) that mentions something specific and interesting from this page — a hook that makes them want to ask more. Conversational, not promotional. No emojis. Match the content — if it's a travel essay, talk about the trip; if it's a design project, talk about the work. Don't force design language onto non-design content. Examples: "This project had a pretty unusual constraint — want me to walk you through it?" or "The part about skiing down Thomastinden in whiteout conditions is wild."

Page content:
${pageText}`
		});

		return json({ message: text.trim() || null });
	} catch (err) {
		console.warn('Proactive message failed:', err);
		return json({ message: null });
	}
};
