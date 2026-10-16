import { env } from '$env/dynamic/private';
import { logRag } from '$lib/server/rag-debug';
import {
	formatNavPagesForPrompt,
	getSiteNavCatalog,
	type NavPage
} from '$lib/server/site-nav-routes';
import { dropAlreadyAnswered } from '$lib/server/suggestion-check';
import {
	buildVisitorContext,
	formatVisitorContextForChips,
	visitorContextEnabled
} from '$lib/server/visitor-context';
import { bestMatchScores, getSitePageText, MIN_VECTOR_SCORE } from '$lib/utilities/context';
import { createOpenAI } from '@ai-sdk/openai';
import { json, type RequestHandler } from '@sveltejs/kit';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

const PAGE_TEXT_MAX = 6000;

// The model writes a few more chips than are shown; any whose nearest knowledge-base chunk is
// below the retrieval floor gets dropped, so a chip never leads straight to "I don't have that".
// (6 candidates so the answerability and already-answered checks still usually leave 3.)
const CANDIDATE_COUNT = 6;
const SHOWN_COUNT = 3;

// Navigation chips ("Take me to the Lyngen project") are answered by routing, not retrieval.
const NAV_CHIP = /^(take me|open|show me|go to)\b/i;

// Chips used to be written from the page path alone, so the model invented plausible-sounding
// questions ("What inspired his travel stories?") that HuntBot then couldn't answer — 6 of the
// first 15 clicked chips led to "I don't have that". Grounding them in the page text fixes that.
const CHIP_RULES = `- Every question must be answerable from the PAGE TEXT or the conversation shown to you. If the text doesn't state it, don't ask it.
- No questions about motivation, inspiration, or feelings ("What inspired…", "Why did he decide…", "How did he feel…") unless the text spells that out.
- Prefer concrete hooks the text actually names: a specific project, decision, constraint, number, place, or tool.
- The visitor is talking to HuntBot, not to Hunter. Refer to him as "Hunter" or "he", never "you" or "your" ("What drew Hunter to maps?", not "What drew you to maps?").
- Make each one a different angle; they are checked against the knowledge base and the weakest are dropped.`;

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
HuntBot can move the visitor to another page on this site. **At most one** of your suggestions may be a short phrase (under 10 words) they would tap to navigate — e.g. "Take me to the Dovetail case study", "Open the projects list", "Show Hunter's about page".
Rules:
- The phrase must clearly match exactly one destination in the list (use its title in natural language; never put URL paths in the chip text).
- Never suggest the page they are already on: ${currentPage}
- If no destination fits, use non-navigation suggestions only.

Destinations:
${formattedList}`;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { currentPage, scrollDepth, sectionHeading, hoveredContent, visitor } = body;
		const messages: Array<{ role?: string }> = Array.isArray(body.messages) ? body.messages : [];

		const path = typeof currentPage === 'string' && currentPage.startsWith('/') ? currentPage : '/';

		let navAppendix = '';
		let pages: NavPage[] = [];
		try {
			pages = (await getSiteNavCatalog()).pages;
			navAppendix = navToolAppendix(path, formatNavPagesForPrompt(pages, path));
		} catch {
			navAppendix = '';
		}

		const hasUserMessages = messages.some((m) => m.role === 'user');

		// Arrival and reading path, reduced to hints that pick an angle (no network lookup here)
		const visitorHints =
			visitorContextEnabled() && visitor && typeof visitor === 'object'
				? formatVisitorContextForChips(
						buildVisitorContext({ request, payload: visitor, pages, currentPage: path, org: null })
					)
				: '';

		// Cached per warm instance (30 min), shared with chat retrieval.
		const pageText = (await getSitePageText(path).catch(() => null))?.slice(0, PAGE_TEXT_MAX);
		const pageTextBlock = pageText ? `\n\nPAGE TEXT (what the visitor can see):\n${pageText}` : '';

		const scrollContext = [
			typeof scrollDepth === 'number' ? `Scroll depth: ${scrollDepth}% through the page.` : '',
			typeof sectionHeading === 'string' && sectionHeading
				? `Visible section: "${sectionHeading.slice(0, 200)}"`
				: '',
			typeof scrollDepth === 'number' && scrollDepth > 60
				? "The visitor has scrolled deeply — they're engaged."
				: ''
		]
			.filter(Boolean)
			.join(' ');
		// Section chips mid-conversation are about what's being read, not follow-ups to the chat,
		// but they still mustn't repeat it.
		const isReading = scrollContext !== '';
		const noRepeatRule = hasUserMessages
			? '\n- The visitor is also chatting with HuntBot (transcript below). Never repeat a question they already asked or one the conversation already answers.'
			: '';

		let systemPrompt: string;

		if (hoveredContent) {
			systemPrompt = `The visitor is reading a page on Hunter Bryant's site and hovering over this section:

"${hoveredContent}"

Current page: ${path}

Generate ${CANDIDATE_COUNT} short suggestions (each under 10 words). Usually they are questions someone reading this passage would ask — specific to the content, not generic. Match the subject matter: travel → the trip; design → the work.
${CHIP_RULES}${noRepeatRule}${navAppendix}${pageTextBlock}

Put the suggestions in the questions list.

Example: ${
				navAppendix
					? '["What was the weather like up there?", "How long did that descent take?", "Take me to the full case study"]'
					: '["What was the weather like up there?", "How long did that descent take?", "Who else joined that trip?"]'
			}`;
		} else if (hasUserMessages && !isReading) {
			systemPrompt = `Generate ${CANDIDATE_COUNT} short follow-up suggestions (each under 10 words) for a visitor chatting with HuntBot on Hunter Bryant's portfolio site.

Current page: ${path}

Rules:
- Read the transcript below. Each suggestion must connect to something explicit there — a name, product or topic that came up. No generic portfolio prompts (e.g. avoid "What projects are showcased here?" unless the chat was about browsing the site).
- The visitor has just read the LAST REPLY. Ask about something it mentions but doesn't explain, or the natural next step. Never ask what the LAST REPLY or an earlier reply already answers, and never repeat a question the visitor already asked.
- Never follow up on something the assistant said it doesn't have or isn't sure about.
${CHIP_RULES}${
				navAppendix
					? '\n- A navigation-style chip is allowed only when the chat clearly points at a specific page you can name from the destination list.'
					: ''
			}${navAppendix}${pageTextBlock}

Put the suggestions in the questions list.

Example: ${
				navAppendix
					? '["How did they handle map clustering?", "Take me to the Karoo case study", "Which constraint shaped that layout?"]'
					: '["How did they handle map clustering?", "What constraint drove that layout?", "How did riders react to it?"]'
			}`;
		} else {
			systemPrompt = `Generate ${CANDIDATE_COUNT} short ${
				hasUserMessages
					? "suggestions (each under 10 words) about the part of Hunter Bryant's portfolio site the visitor is reading now"
					: "starter suggestions (each under 10 words) for a new visitor on Hunter Bryant's portfolio site"
			}.

Current page: ${path}${scrollContext ? '\n' + scrollContext : ''}

Hunter is a product designer, but his site also includes personal writing, travel stories, and side projects. Not everything is design work.

Rules:
- Tailor to the current page and visible section context — if it's a travel blog, ask about the trip, not "the design process"
- Make them feel like genuine curiosity, not marketing prompts
${CHIP_RULES}${noRepeatRule}${
				navAppendix
					? '\n- On home, about, or listing pages, include **exactly one** navigation-style suggestion when a natural fit exists. On a specific case study or project page, use **at most one** navigation chip and only when it points to a *different* listed page.'
					: ''
			}${navAppendix}${pageTextBlock}${visitorHints}

Put the suggestions in the questions list.

Example: ${
				navAppendix
					? '["What kind of projects does Hunter take on?", "Take me to the Dovetail case study", "What was this trip like?"]'
					: '["What kind of projects does Hunter take on?", "How did he end up in SF?", "What was this trip like?"]'
			}`;
		}

		const turns = hasUserMessages
			? (messages as Array<{ role?: string; content?: unknown; parts?: unknown }>)
					.filter((m) => m.role === 'user' || m.role === 'assistant')
					.map((m) => ({ role: m.role as string, text: plainTextFromMessage(m) }))
					.filter((t) => t.text)
					.slice(-8)
			: [];
		const conversationContext = turns.length
			? turns.map((t) => `${t.role}: ${t.text}`).join('\n')
			: null;
		const lastReply = [...turns].reverse().find((t) => t.role === 'assistant')?.text ?? '';
		const visitorQuestions = turns.filter((t) => t.role === 'user').map((t) => t.text);

		const { output } = await generateText({
			model: openai('gpt-6-luna'),
			reasoning: 'low',
			// Includes reasoning tokens, so leave headroom beyond the short output itself.
			maxOutputTokens: 400,
			providerOptions: { openai: { reasoningSummary: null } },
			output: Output.object({ schema: z.object({ questions: z.array(z.string()) }) }),
			instructions: systemPrompt,
			prompt: conversationContext
				? `Recent conversation (most recent last):\n${conversationContext}${
						lastReply ? `\n\nLAST REPLY (the visitor just read this):\n${lastReply}` : ''
					}`
				: 'No conversation yet — suggest openers.'
		});

		const candidates = output.questions
			.map((s) => s.trim())
			.filter((s) => s.length > 0)
			.slice(0, CANDIDATE_COUNT);
		const suggestions = await keepAnswerable(candidates, lastReply, visitorQuestions);

		return json({ suggestions });
	} catch (err) {
		console.warn('Chat suggestions failed:', err);
		return json({ suggestions: [] });
	}
};

/** Drops chips the knowledge base can't back up, and (after a reply) chips that reply already
 *  answers, keeping the model's order. If either check itself fails, its chips go out unchecked
 *  rather than not at all. */
async function keepAnswerable(
	candidates: string[],
	lastReply: string,
	visitorQuestions: string[]
): Promise<string[]> {
	const questions = candidates.filter((c) => !NAV_CHIP.test(c));
	const [scoresResult, answered] = await Promise.all([
		bestMatchScores(questions).catch((err) => {
			console.warn('Suggestion answerability check failed:', err);
			return null;
		}),
		// Starter, scroll and hover chips have no reply to repeat.
		lastReply
			? dropAlreadyAnswered(questions, lastReply, visitorQuestions)
			: Promise.resolve({ kept: questions, probabilities: {} })
	]);
	const scoreOf = new Map(questions.map((q, i) => [q, scoresResult?.[i] ?? 0]));
	logRag('suggestion scores', {
		scores: Object.fromEntries(scoreOf),
		already_answered: answered.probabilities
	});
	const notAnswered = new Set(answered.kept);
	return candidates
		.filter(
			(c) =>
				NAV_CHIP.test(c) ||
				(notAnswered.has(c) && (scoresResult === null || (scoreOf.get(c) ?? 0) >= MIN_VECTOR_SCORE))
		)
		.slice(0, SHOWN_COUNT);
}
