import { env } from '$env/dynamic/private';
import { formatNavPagesForPrompt, getSiteNavCatalog } from '$lib/server/site-nav-routes';
import { getSitePageText } from '$lib/utilities/context';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

const PAGE_TEXT_MAX = 6000;

// Chips used to be written from the page path alone, so the model invented plausible-sounding
// questions ("What inspired his travel stories?") that HuntBot then couldn't answer — 6 of the
// first 15 clicked chips led to "I don't have that". Grounding them in the page text fixes that.
const ANSWERABLE_RULES = `- Every question must be answerable from the PAGE TEXT or the conversation shown to you. If the text doesn't state it, don't ask it.
- No questions about motivation, inspiration, or feelings ("What inspired…", "Why did he decide…", "How did he feel…") unless the text spells that out.
- Prefer concrete hooks the text actually names: a specific project, decision, constraint, number, place, or tool.`;

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

		const path =
			typeof currentPage === 'string' && currentPage.startsWith('/') ? currentPage : '/';

		let navAppendix = '';
		try {
			const { pages } = await getSiteNavCatalog();
			navAppendix = navToolAppendix(path, formatNavPagesForPrompt(pages, path));
		} catch {
			navAppendix = '';
		}

		const hasUserMessages = messages.some((m: { role: string }) => m.role === 'user');

		// Cached per warm instance (30 min), shared with chat retrieval.
		const pageText = (await getSitePageText(path).catch(() => null))?.slice(0, PAGE_TEXT_MAX);
		const pageTextBlock = pageText ? `\n\nPAGE TEXT (what the visitor can see):\n${pageText}` : '';

		const scrollContext =
			!hasUserMessages
				? [
						typeof scrollDepth === 'number'
							? `Scroll depth: ${scrollDepth}% through the page.`
							: '',
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

Generate 3 short suggestions (each under 10 words). Usually they are questions someone reading this passage would ask — specific to the content, not generic. Match the subject matter: travel → the trip; design → the work.
${ANSWERABLE_RULES}${navAppendix}${pageTextBlock}

Put the suggestions in the questions list.

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
- Prefer deepening the current thread over changing subject.
- Never follow up on something the assistant said it doesn't have or isn't sure about.
${ANSWERABLE_RULES}${
				navAppendix
					? '\n- A navigation-style chip is allowed only when the chat clearly points at a specific page you can name from the destination list.'
					: ''
			}${navAppendix}${pageTextBlock}

Put the suggestions in the questions list.

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
- Make them feel like genuine curiosity, not marketing prompts
${ANSWERABLE_RULES}${
				navAppendix
					? '\n- On home, about, or listing pages, include **exactly one** navigation-style suggestion when a natural fit exists. On a specific case study or project page, use **at most one** navigation chip and only when it points to a *different* listed page.'
					: ''
			}${navAppendix}${pageTextBlock}

Put the suggestions in the questions list.

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

		const { output } = await generateText({
			model: openai('gpt-6-luna'),
			reasoning: 'low',
			// Includes reasoning tokens, so leave headroom beyond the short output itself.
			maxOutputTokens: 400,
			providerOptions: { openai: { reasoningSummary: null } },
			output: Output.object({ schema: z.object({ questions: z.array(z.string()) }) }),
			instructions: systemPrompt,
			prompt: conversationContext
				? `Recent conversation (most recent last):\n${conversationContext}`
				: 'No conversation yet — suggest openers.'
		});

		const suggestions = output.questions.filter((s) => s.trim().length > 0).slice(0, 3);

		return json({ suggestions });
	} catch (err) {
		console.warn('Chat suggestions failed:', err);
		return json({ suggestions: [] });
	}
};
