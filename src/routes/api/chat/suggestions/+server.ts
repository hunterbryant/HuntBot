import { env } from '$env/dynamic/private';
import { formatNavPagesForPrompt, getSiteNavCatalog } from '$lib/server/site-nav-routes';
import { json, type RequestHandler } from '@sveltejs/kit';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/** AI SDK UI messages use `parts`; older code used `content`. */
function plainTextFromMessage(m: { role?: string; content?: unknown; parts?: unknown }): string {
	if (typeof m.content === 'string' && m.content.trim()) return m.content.trim();
	if (!Array.isArray(m.parts)) return '';
	return m.parts
		.filter(
			(p): p is { type: string; text: string } =>
				p !== null &&
				typeof p === 'object' &&
				(p as { type?: string }).type === 'text' &&
				typeof (p as { text?: string }).text === 'string'
		)
		.map((p) => p.text)
		.join('')
		.trim();
}

function navToolAppendix(currentPage: string, formattedList: string): string {
	if (!formattedList.trim()) return '';
	return `

## Optional navigation-style chip
HuntBot can move the visitor to another page on this site. **At most one** of your 3 suggestions may be a short phrase (under 10 words) they would tap to navigate — e.g. "Take me to the Dovetail case study", "Open the projects list", "Show Hunter's about page".
Rules:
- The phrase must clearly match exactly one destination in the list (use its title in natural language; never put URL paths in the chip text).
- Never suggest the page they are already on: ${currentPage}
- If no destination fits, use three non-navigation suggestions only.

Destinations:
${formattedList}`;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { messages, currentPage, scrollDepth, sectionHeading, hoveredContent } =
			await request.json();

		const path = typeof currentPage === 'string' && currentPage.startsWith('/') ? currentPage : '/';

		let navAppendix = '';
		try {
			const { pages } = await getSiteNavCatalog();
			navAppendix = navToolAppendix(path, formatNavPagesForPrompt(pages, path));
		} catch {
			navAppendix = '';
		}

		const hasUserMessages = messages.some((m: { role: string }) => m.role === 'user');

		const scrollContext = !hasUserMessages
			? [
					typeof scrollDepth === 'number' ? `Scroll depth: ${scrollDepth}% through the page.` : '',
					sectionHeading ? `Visible section: "${sectionHeading}"` : '',
					typeof scrollDepth === 'number' && scrollDepth > 60
						? "The visitor has scrolled deeply — they're engaged."
						: ''
				]
					.filter(Boolean)
					.join(' ')
			: '';

		let systemPrompt: string;

		if (hoveredContent) {
			systemPrompt = `The visitor is reading a page on Hunter Bryant's site and hovering over this section:

"${hoveredContent}"

Current page: ${path}

Generate 3 short suggestions (each under 10 words). Usually they are questions someone reading this passage would ask — specific to the content, not generic. Match the subject matter: travel → the trip; design → the work.${navAppendix}

Return ONLY a JSON array of strings, nothing else.

Example: ${
				navAppendix
					? '["What was the weather like up there?", "How long did that descent take?", "Take me to the full case study"]'
					: '["What was the weather like up there?", "How long did that descent take?", "Who else joined that trip?"]'
			}`;
		} else if (hasUserMessages) {
			systemPrompt = `Generate 3 short follow-up suggestions (each under 10 words) for a visitor chatting with HuntBot on Hunter Bryant's portfolio site.

Current page: ${path}

Rules:
- Read the transcript below. Each suggestion MUST tie to something explicit there — names, products, topics, or the assistant's last answer. No generic portfolio prompts (e.g. avoid "What projects are showcased here?" unless the chat was about browsing the site).
- Prefer deepening the current thread over changing subject.${
				navAppendix
					? '\n- A navigation-style chip is allowed only when the chat clearly points at a specific page you can name from the destination list.'
					: ''
			}${navAppendix}

Return ONLY a JSON array of strings, nothing else

Example: ${
				navAppendix
					? '["How did they handle map clustering?", "Take me to the Karoo case study", "What\'s Yuki doing at AMD?"]'
					: '["How did they handle map clustering?", "What constraint drove that layout?", "What\'s Yuki doing at AMD?"]'
			}`;
		} else {
			systemPrompt = `Generate 3 short starter suggestions (each under 10 words) for a new visitor on Hunter Bryant's portfolio site.

Current page: ${path}${scrollContext ? '\n' + scrollContext : ''}

Hunter is a product designer, but his site also includes personal writing, travel stories, and side projects. Not everything is design work.

Rules:
- Tailor to the current page and visible section context — if it's a travel blog, ask about the trip, not "the design process"
- Make them feel like genuine curiosity, not marketing prompts${
				navAppendix
					? '\n- On home, about, or listing pages, include **exactly one** navigation-style suggestion when a natural fit exists. On a specific case study or project page, use **at most one** navigation chip and only when it points to a *different* listed page.'
					: ''
			}${navAppendix}

Return ONLY a JSON array of strings, nothing else

Example: ${
				navAppendix
					? '["What kind of projects does Hunter take on?", "Take me to the Dovetail case study", "What was this trip like?"]'
					: '["What kind of projects does Hunter take on?", "How did he end up in SF?", "What was this trip like?"]'
			}`;
		}

		const conversationContext = hasUserMessages
			? (messages as Array<{ role?: string; content?: unknown; parts?: unknown }>)
					.filter((m) => m.role === 'user' || m.role === 'assistant')
					.map((m) => {
						const text = plainTextFromMessage(m);
						return text && m.role ? `${m.role}: ${text}` : null;
					})
					.filter((line): line is string => line !== null)
					.slice(-8)
					.join('\n')
			: null;

		const response = await openai.chat.completions.create({
			model: 'gpt-4.1-mini',
			messages: [
				{ role: 'system', content: systemPrompt },
				...(conversationContext
					? [
							{
								role: 'user' as const,
								content: `Recent conversation (most recent last):\n${conversationContext}`
							}
						]
					: [])
			],
			temperature: 0.7,
			max_tokens: 200
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
			.slice(0, 3);

		return json({ suggestions });
	} catch {
		return json({ suggestions: [] });
	}
};
