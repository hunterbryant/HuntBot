import { env } from '$env/dynamic/private';
import { compile } from 'html-to-text';
import { json, type RequestHandler } from '@sveltejs/kit';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
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

		const response = await openai.chat.completions.create({
			model: 'gpt-4.1-mini',
			messages: [
				{
					role: 'system',
					content: `You are HuntBot, an assistant on Hunter Bryant's portfolio. A visitor just arrived on a specific project or case study page. Write a single natural sentence (max 20 words) that mentions something specific and interesting from this page — a hook that makes them want to ask more. Conversational, not promotional. No emojis. Examples: "This project had a pretty unusual constraint — want me to walk you through it?" or "The sensor calibration work on this one was surprisingly deep."

Page content:
${pageText}`
				}
			],
			max_tokens: 60,
			temperature: 0.8
		});

		const message = response.choices[0]?.message?.content?.trim() ?? null;
		return json({ message });
	} catch {
		return json({ message: null });
	}
};
