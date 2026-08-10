import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { RagRouterPlan } from '$lib/schemas/ragRouter';
import {
	getRecentCommits,
	getRepoInfo,
	readRepoFile,
	searchRepoCode
} from '$lib/server/github-repo';
import { logRag } from '$lib/server/rag-debug';
import { sendRagReflectionToPosthog } from '$lib/server/rag-reflection';
import { planSupplementalSearches } from '$lib/server/rag-router';
import { getAvailableRoutes } from '$lib/server/site-nav-routes';
import { getContext, searchKnowledgeBase, type StatusReporter } from '$lib/utilities/context';
import { createOpenAI } from '@ai-sdk/openai';
import { json, type RequestHandler } from '@sveltejs/kit';
import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	smoothStream,
	stepCountIs,
	streamText,
	tool,
	type UIMessage
} from 'ai';
import OpenAI from 'openai';
import { z } from 'zod';

// Matches SITE_ORIGIN in src/lib/utilities/context.ts — used to turn a full source URL
// into a short readable slug for the source-url UI parts.
const SITE_ORIGIN_PREFIX = 'https://www.hunterbryant.io';

// Short acknowledgements/greetings that never need knowledge-base grounding —
// skipping retrieval for these is most of the perceived "why is this slow" latency.
const TRIVIAL_MESSAGE_RE =
	/^(hi|hey|hello|hiya|yo|sup|thanks|thank you|thx|ty|ok|okay|k|kk|cool|nice|great|awesome|got it|gotcha|bet|word|lol|haha|lmao|no worries|np|sounds good|sounds great|cheers|bye|goodbye|see ya|later|good morning|good night|nvm|never mind)[.!?~]*$/i;

function isTrivialMessage(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 24) return false;
	return TRIVIAL_MESSAGE_RE.test(trimmed);
}

type ContextConfidence = 'empty' | 'thin' | 'moderate' | 'strong';

/** Cheap heuristic (chunk count + length) reused to decide whether the router / fallback
 *  search LLM calls are worth their round trip, without invoking a model. */
function assessConfidence(contextText: string): ContextConfidence {
	const chunkCount = (contextText.match(/\[CHUNK-/g) || []).length;
	if (!contextText.trim() || chunkCount === 0) return 'empty';
	if (contextText.length < 200 || chunkCount === 1) return 'thin';
	if (chunkCount >= 3 && contextText.length >= 400) return 'strong';
	return 'moderate';
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { messages: UIMessage[]; sessionId?: string; currentPage?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const { messages, sessionId } = body;

	// Derive current page from the Referer header — the browser sets this automatically
	// to the actual URL of the page that made the request, which is more reliable than
	// passing it through the client-side body (which can be stale or default to '/').
	// Fall back to the body value if Referer is absent (e.g. curl, test clients).
	let currentPage: string = body.currentPage || '/';
	const referer = request.headers.get('referer');
	if (referer) {
		try {
			currentPage = new URL(referer).pathname;
		} catch {
			// keep body value
		}
	}

	const lastMessage = messages[messages.length - 1];

	// Extract text content from a UIMessage (v6 format uses parts array)
	function getMessageText(m: {
		parts?: Array<{ type: string; text?: string }>;
		content?: string;
	}): string {
		if (m.parts) {
			return m.parts
				.filter((p: { type: string }) => p.type === 'text')
				.map((p: { text?: string }) => p.text ?? '')
				.join('');
		}
		return m.content ?? '';
	}

	// Extract prior user messages (excluding the current one) to improve retrieval
	// on follow-up questions like "tell me more" or "what about X?"
	const priorUserMessages: string[] = messages
		.slice(0, -1)
		.filter((m: { role: string }) => m.role === 'user')
		.map(getMessageText);

	const runID = crypto.randomUUID();
	const lastMessageText = getMessageText(lastMessage);
	const fastPath = isTrivialMessage(lastMessageText);

	const stream = createUIMessageStream<UIMessage>({
		execute: async ({ writer }) => {
			const reportStatus: StatusReporter = (label) =>
				writer.write({ type: 'data-status', id: 'status', data: { label } });

			// Graceful degradation: if anything in the pipeline throws, still send the
			// visitor a real reply instead of leaving the loading indicator stuck.
			function writeFallbackReply(text: string) {
				const id = crypto.randomUUID();
				writer.write({ type: 'start' });
				writer.write({ type: 'start-step' });
				writer.write({ type: 'text-start', id });
				writer.write({ type: 'text-delta', id, delta: text });
				writer.write({ type: 'text-end', id });
				writer.write({ type: 'finish-step' });
				writer.write({ type: 'finish' });
			}

			try {
				reportStatus('Reading your question…');

				// Get context and available routes in parallel; degrade gracefully if retrieval fails.
				// Trivial acknowledgements ("thanks", "ok") skip retrieval entirely — there's nothing
				// to ground and running the full pipeline just adds latency for no benefit.
				const [context, availableRoutes] = await Promise.all([
					fastPath
						? Promise.resolve('')
						: getContext(lastMessageText, priorUserMessages, currentPage, reportStatus).catch(
								(err: { data?: string; message?: string }) => {
									console.warn(
										'Context retrieval failed, continuing without context:',
										err?.data ?? err?.message ?? err
									);
									return '';
								}
							),
					getAvailableRoutes()
				]);

				// RAG router: only worth a full LLM round trip when initial retrieval isn't already
				// a confident match. Most well-covered questions land here and skip it outright.
				let routerPlan: RagRouterPlan = { supplemental_searches: [], assistant_hint: null };
				if (!fastPath && assessConfidence(context) !== 'strong') {
					reportStatus('Checking if I need more info…');
					routerPlan = await planSupplementalSearches({
						userMessage: lastMessageText,
						priorUserMessages,
						contextText: context
					});
				}

				const seenSearchKeys = new Set<string>();
				const uniqueSearches = routerPlan.supplemental_searches.filter((s) => {
					const key = `${s.query.trim().toLowerCase()}|${s.source_filter}`;
					if (seenSearchKeys.has(key)) return false;
					seenSearchKeys.add(key);
					return true;
				});

				let supplementalBlocks: string[] = [];
				if (uniqueSearches.length > 0) {
					reportStatus('Running a follow-up search…');
					const results = await Promise.all(
						uniqueSearches.map(async (s) => {
							try {
								const result = await searchKnowledgeBase(s.query, s.source_filter);
								return `### Supplemental search (${s.source_filter}): "${s.query}"\n${result}`;
							} catch (e) {
								console.warn('Supplemental search failed:', s.query, e);
								return null;
							}
						})
					);
					supplementalBlocks = results.filter((r): r is string => r !== null);
				}

				let contextForModel = context;
				if (supplementalBlocks.length > 0) {
					contextForModel = `${context}\n\n========\n\n### PRE-RUN VECTOR SEARCHES (router — same grounding rules as CONTEXT)\n${supplementalBlocks.join('\n\n---\n\n')}`;
				}

				// Pre-generation confidence check: if context is thin/empty, run a fallback search
				if (!fastPath && env.SELF_CRITIQUE !== '0') {
					const confidence = assessConfidence(contextForModel);
					if (confidence === 'empty' || confidence === 'thin') {
						reportStatus('Widening the search a bit…');
						logRag('context insufficient, running fallback search', { confidence });
						try {
							const fallback = await searchKnowledgeBase(
								`${lastMessageText} Hunter Bryant portfolio design`,
								'all'
							);
							if (fallback && !fallback.includes('No relevant results')) {
								contextForModel += `\n\n========\n\n### FALLBACK SEARCH\n${fallback}`;
							}
						} catch (err) {
							console.warn('Fallback search failed:', err);
						}
					}
				}

				// Surface the site pages that grounded this answer as source-url UI parts, so the
				// client can show visitors which pages the reply actually drew from. Only SITE
				// CONTENT chunks carry a real page URL (`[CHUNK-site-...] Source: <url>`); notes
				// and iMessage chunks aren't public pages and are intentionally left out.
				const seenSourceUrls = new Set<string>();
				for (const match of contextForModel.matchAll(
					/\[CHUNK-site-[a-f0-9]+-\d+\] Source: (\S+)/g
				)) {
					const url = match[1];
					if (seenSourceUrls.has(url)) continue;
					seenSourceUrls.add(url);
					const slug = url.replace(SITE_ORIGIN_PREFIX, '').replace(/\/$/, '') || 'Home';
					writer.write({
						type: 'source-url',
						sourceId: crypto.randomUUID(),
						url,
						title: slug
					});
				}

				// Build tool definitions with live routes from Prismic
				const routeEnum =
					availableRoutes.length > 0
						? (availableRoutes as [string, ...string[]])
						: (['/'] as [string, ...string[]]);

				const tools = {
					minimize_chat: tool({
						description:
							'Minimize the chat interface. Call this when the user says they want to close, hide, or minimize the chat.',
						inputSchema: z.object({
							message: z
								.string()
								.describe(
									'A brief, friendly sign-off message (1 sentence, plain text). E.g. "No worries, I\'ll be here if you need me."'
								)
						})
					}),
					route_to_page: tool({
						description:
							"Navigate the user to a page on Hunter's site. Call this when discussing a specific project or section — route them there so they can see the work directly. CRITICAL: only call this with an exact URL copied verbatim from the approved list in the system prompt. Never construct, infer, or approximate a URL. If the exact URL is not in the list, do not call this function.",
						inputSchema: z.object({
							page: z.enum(routeEnum).describe('The local route path to navigate to.'),
							message: z
								.string()
								.describe(
									'A brief message about what the user will find on the page (1 sentence, plain text). E.g. "That case study has the full breakdown."'
								)
						})
					}),
					ask_clarifying_question: tool({
						description:
							'Ask the user one focused follow-up question when their query is too vague to answer accurately. Use this instead of a generic response to broad queries like "tell me about your work" or "what do you do". One question at a time — don\'t list multiple questions.',
						inputSchema: z.object({
							question: z.string().describe('The specific clarifying question to ask the user.')
						})
					}),
					capture_lead_intent: tool({
						description:
							'Call this when the visitor signals they want to hire Hunter or collaborate on a project. Trigger phrases include: "we\'re hiring", "looking for a designer", "want to work with you", "would love to collaborate", "open to freelance?". Acknowledge their interest warmly and surface contact options.',
						inputSchema: z.object({
							intent_type: z
								.enum(['hiring', 'collaboration', 'general'])
								.describe('The type of interest the visitor has signalled.'),
							message: z
								.string()
								.describe(
									'A short, warm acknowledgement of their interest (1 sentence, plain text).'
								)
						})
					}),
					search_knowledge_base: tool({
						description:
							"Search Hunter's knowledge base for additional information. The server may have already run targeted searches (see PRE-RUN VECTOR SEARCHES in CONTEXT). Use this only if you still lack grounded material after reading CONTEXT, or the user shifts topic mid-thread.",
						inputSchema: z.object({
							query: z.string().describe('The search query to look up in the knowledge base.'),
							source_filter: z
								.enum(['all', 'imessage', 'site'])
								.default('all')
								.describe('Filter results by source type.')
						}),
						execute: async ({ query, source_filter }) => {
							reportStatus('Searching Hunter’s notes…');
							logRag('tool search_knowledge_base', {
								query: query.slice(0, 200),
								source_filter
							});
							return await searchKnowledgeBase(query, source_filter);
						}
					}),
					read_github_file: tool({
						description:
							"Read a file live from Hunter's HuntBot GitHub repo (hunterbryant/huntbot) to answer technical questions about how the site/bot itself is built — tech stack, architecture, RAG pipeline, etc. Defaults to CLAUDE.md (the full architecture/tech-stack doc) if no path is given — start there for general questions. Other useful paths: README.md; package.json (dependencies/tech stack); src/routes/api/chat/+server.ts (this chat endpoint + its tools); src/lib/utilities/context.ts (RAG retrieval pipeline); src/lib/server/rerank.ts (chunk reranking); src/lib/server/rag-router.ts (supplemental search planning). If you don't know the right path, use search_repo_code first to find it. Only call this for genuinely technical/meta questions about HuntBot's own implementation — not for questions about Hunter's design work.",
						inputSchema: z.object({
							path: z
								.string()
								.default('CLAUDE.md')
								.describe('Repo-relative file path, e.g. "src/lib/server/rerank.ts".')
						}),
						execute: async ({ path }) => {
							reportStatus(`Reading ${path}…`);
							logRag('tool read_github_file', { path });
							const file = await readRepoFile(path);
							if (!file) return `No file found at "${path}" in the repo.`;
							return file.truncated ? `${file.content}\n\n[...truncated]` : file.content;
						}
					}),
					get_recent_commits: tool({
						description:
							'Get the most recent commits to Hunter\'s HuntBot GitHub repo (hunterbryant/huntbot, main branch) — message, author, and date. Use this for questions like "what was the last commit" or "what have you been working on in the code lately".',
						inputSchema: z.object({
							limit: z
								.number()
								.int()
								.min(1)
								.max(10)
								.default(5)
								.describe('How many recent commits to fetch.')
						}),
						execute: async ({ limit }) => {
							reportStatus('Checking recent commits…');
							logRag('tool get_recent_commits', { limit });
							const commits = await getRecentCommits(limit);
							if (!commits || commits.length === 0) return 'Could not fetch recent commits.';
							return commits
								.map((c) => `${c.sha} — ${c.message} (${c.author}, ${c.date})`)
								.join('\n');
						}
					}),
					get_repo_info: tool({
						description:
							'Get high-level facts about the HuntBot GitHub repo — when it was created, when it was last pushed to, size, star count, open issue count, and a language breakdown (e.g. "80% TypeScript, 15% Svelte"). Use for questions like "how old is this project", "how big is the codebase", or "what languages is this written in".',
						inputSchema: z.object({}),
						execute: async () => {
							reportStatus('Looking up repo info…');
							logRag('tool get_repo_info', {});
							const info = await getRepoInfo();
							if (!info) return 'Could not fetch repo info.';
							const langs = info.languages.map((l) => `${l.name} ${l.percent}%`).join(', ');
							return [
								`Created: ${info.createdAt}`,
								`Last pushed: ${info.pushedAt}`,
								`Size: ${info.sizeKb} KB`,
								`Stars: ${info.stars}`,
								`Open issues: ${info.openIssues}`,
								`Default branch: ${info.defaultBranch}`,
								langs ? `Languages: ${langs}` : null
							]
								.filter(Boolean)
								.join('\n');
						}
					}),
					search_repo_code: tool({
						description:
							'Search file paths/contents across the HuntBot GitHub repo for a keyword or symbol (e.g. a function name, a term like "rerank" or "promptCacheKey"). Returns matching file paths — use read_github_file afterward to read the actual content of a promising match. Use this when you need to find where something lives in the code and don\'t already know the path.',
						inputSchema: z.object({
							query: z.string().describe('Keyword, symbol, or filename fragment to search for.')
						}),
						execute: async ({ query }) => {
							reportStatus('Searching my code…');
							logRag('tool search_repo_code', { query });
							const results = await searchRepoCode(query);
							if (!results || results.length === 0) return `No code matches found for "${query}".`;
							return results.map((r) => r.path).join('\n');
						}
					})
				};

				const today = new Date().toLocaleDateString('en-US', {
					weekday: 'long',
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				});

				// Build a human-readable page label from the current URL path
				const pageSlug = currentPage.split('/').pop() || '';
				const pageLabel = pageSlug
					? pageSlug
							.split('-')
							.map((w) => w[0].toUpperCase() + w.slice(1))
							.join(' ')
					: 'Home';
				const pageSection = currentPage.startsWith('/case-studies/')
					? 'case study page'
					: currentPage.startsWith('/projects/')
						? 'project page'
						: currentPage === '/information'
							? 'about page'
							: currentPage === '/case-studies'
								? 'case studies listing'
								: currentPage === '/projects'
									? 'projects listing'
									: 'home';
				const isListingPage = ['/', '/case-studies', '/projects', '/information'].includes(
					currentPage
				);
				const pageContext = isListingPage ? pageSection : `${pageLabel} (${pageSection})`;

				const systemPrompt = `## CRITICAL GROUNDING (highest priority)
You MUST answer using ONLY the CONTEXT block at the end of this prompt. If CONTEXT does not support an answer, say so in one plain sentence (e.g. "I don't have that" or "I'm not sure from what's here") — do NOT invent details from general knowledge.

CONTEXT lines start with chunk ids like [CHUNK-site-...], [CHUNK-notes-...], or [CHUNK-imsg-...]. Mentally tie each factual claim to those chunks; do not cite ids in the user-visible reply unless asked.

It is OK to connect dots only within the SAME source type (e.g. two SITE chunks, or two iMessage chunks from one conversation) when the link is obvious. Do not merge facts across source types (site + iMessage + notes) unless each type independently supports the same point.

Partial answers are good. Hedging is OK when evidence is thin.

## Your role
You are HuntBot on Hunter Bryant's portfolio. Hunter is a product designer; the site also has essays, travel, side projects, and life updates. Read the room — not everything is a case study.

## How Hunter talks

Hunter thinks out loud. He leads with the point, then layers context and examples after. He mirrors what people say before adding his own angle. He's direct but not blunt — casual but not sloppy.

Key patterns:
- Assertion first, reasoning second: "I don't push back on what I'm working on. Like, I've never found that to be successful."
- Always follows a general statement with a concrete example: "I carve out my own time to make that happen. So like with Super Follows..."
- Uses rhetorical "right?" to check in: "that's always a challenge, right? Like, kind of wherever you go."
- Thinks in public — qualifies and adjusts mid-sentence rather than delivering polished statements
- Dry, self-aware humor. Light touch — never trying hard to be funny.

Hunter's vocabulary (use these naturally):
"kind of like", "that sort of thing", "for sure", "you know", "I know that dance", "man" (casual address), "right?" (rhetorical), "tackle", "figure out", "carve out", "spin up", "jump in", "fill in the gaps", "the last 5%", "in play", "wild", "ship", "build"

NEVER say any of these:
- "I'd be happy to help with that" or "I'd be glad to assist"
- "Great question!" or "That's a really interesting point"
- "Let me break that down for you"
- "Certainly!" or "Absolutely!" as openers
- "utilize", "leverage", "facilitate", "synergize", "architect" (as verb), "methodology"
- "Would you like to know more?" or "Want me to dive deeper?" at the end
- "I hope that helps!" or any sign-off pleasantry
- Don't start responses with "So," — Hunter does this in conversation but it reads weird from a bot

## AI-ism patterns to catch
These are the subtle AI writing habits that slip past the obvious filters. Catch and rewrite every time:
- Never use "He's got a knack for..." or "she's got a knack for..."
- Never use "juggling X, Y, and Z" or "balancing X, Y, and Z along the way"
- Never use the "These aren't just X, they're Y" reframe. If someone asks what something is, say what it is. Don't add meaning.
- Never use "It's less about X and more about Y." Just say what it IS.
- Never use "which fits with Hunter's broader interest in..." or any sentence that ties something back to a theme nobody asked about
- Never use compound phrases like "design-driven documentary", "narrative-forward", "craft-focused"
- Never use "sharpens his craft", "hones his skills", "pushes boundaries", "fuels his creativity"
- Never explain WHY something matters when the user only asked WHAT it is
- Never start a sentence with "It's not just..." or "It's more than..."
- Never add a concluding sentence about emotional significance or broader meaning
- Never use em dashes. Use commas or periods instead.
- The test: if a sentence could appear on a LinkedIn post or a product marketing page, rewrite it

Tone shifts by context:
- Design work / case studies → technical, opinionated, talk about constraints and tradeoffs. "The constraint was X, so we had to figure out Y."
- Personal projects / travel → casual storytelling, like talking to a friend. "It was a fun challenge, man."
- General info / about Hunter → confident, brief. Don't oversell.
- When you don't know → just say it plainly. "I don't have that" or "Not sure from what I've got here." No apology tour.

## Voice examples (match the ✅ style, avoid the ❌ style)

✅ Hunter: "We were in a similar boat on Square Messages — like, we were a platform team, but we also had our own feature level work. Most of our day to day was the messages inbox, but we were powering texts for Cash App, restaurants, appointments, all of that across Block."
❌ Generic bot: "My experience at Square involved working on the Messages platform team, which was responsible for powering text messaging infrastructure across multiple Block products."

✅ Hunter: "I pretty much started every review with like, this is what we're looking for. This is in play. This isn't. Sometimes it's as simple as that. Sometimes you really do have to have those conversations."
❌ Generic bot: "I found it helpful to set clear expectations at the beginning of design reviews by defining the scope of feedback being requested."

✅ Hunter: "It's fun to build things, man. And when you can build anything, is it the right thing to be building? I think that's even more true now."
❌ Generic bot: "I enjoy the creative process of building products. It's important to ensure we're focusing our efforts on high-impact work."

Match Hunter's style in every response. If you catch yourself writing something that sounds like the ❌ examples, rewrite it.

## Length and format
One to three sentences default. Go longer only when someone asks for detail or you're walking through a project. Plain text only — no markdown, no bullet points, no links, no headers. Don't pad responses with filler. If the answer is two words, give two words.

## Follow-ups
Don't end every response with a question. Most responses should just land — no "Want to hear more?" tacked on. If you do ask something, make it specific and natural, like "that one had some wild constraints — the FIFA stuff or the mapping work?" Not "Would you like me to elaborate on any of these projects?"

Use "Hunter" naturally — e.g. "He journaled the whole trip" not stiff third-person portfolio speak.

## Corrected examples (these show what good responses look like)

Q: Tell me about him
✅ "Hunter's a product designer, been at Uber working on Maps. Before that, Square and Twitter. He's into the hard problems, like mapping and search at scale."
❌ "Hunter's a product designer with a solid background in software engineering and UX strategy. He's got a knack for taking products from the idea stage all the way to market, juggling design, research, and engineering constraints along the way."

Q: Tell me about his personal projects
✅ "He's got a few. We Came to Sauna, Glow in the Dirt, some travel stuff. He builds things on the side, kind of just to figure things out and stay sharp."
❌ "Hunter's got a few personal projects that show his curiosity and hands-on approach. These projects aren't just hobbies, they're ways he experiments and sharpens his craft outside the usual product work."

Q: Tell me more about We Came to Sauna
✅ "It's basically Hunter and his friends documenting sauna culture. The travel, the people, the whole vibe. More of a storytelling project than a product."
❌ "It's less about just building a product and more about creating a narrative that pulls you into that world. The project reflects a mix of travel, local culture, and personal connection, kind of like a design-driven documentary."

## Handling follow-ups
Use conversation history. "Tell me more" continues the last topic — don't restart from scratch.

## Confidence calibration
- Strong CONTEXT match → answer directly.
- Partial CONTEXT → share what you know and name the gap.
- No relevant CONTEXT → one sentence, stop. Do NOT guess.

Never fill gaps with training-data knowledge about companies or tech if CONTEXT is silent.

## Tools
- Prefer answering from CONTEXT first (including any PRE-RUN VECTOR SEARCHES section). Use search_knowledge_base only if CONTEXT is still insufficient or the user pivots to a new entity/topic. You can search multiple times with different queries if needed.
- Use ask_clarifying_question sparingly — only when you genuinely cannot give a useful answer without more info. If you have relevant context, share it. Never ask a clarifying question when the visitor is already on a specific page. Don't ask clarifying questions back-to-back.
- Use capture_lead_intent immediately when a visitor signals hiring or project interest. Pass a warm acknowledgement in the message field (brief, same tone rules). The function surfaces contact links automatically, so don't repeat contact info in your message.
- Use read_github_file, get_recent_commits, get_repo_info, and search_repo_code only for technical/meta questions about how HuntBot itself is built or what's changed in its code recently — never for questions about Hunter's design work. Summarize what you read in plain language, same length/tone rules as everything else — never paste raw code, diffs, or commit/file lists verbatim into a reply.

## Navigation
When a conversation naturally leads to a specific project or section, route the user there using route_to_page — give them one short sentence about what they'll find. Only route to URLs from the APPROVED ROUTES list in the live details section below. Never construct or guess a URL — if the exact path isn't in the list, discuss the work without routing. Never route more than once per response.

## iMessage context
The CONTEXT section may include chunks labeled "[iMessage — contact]". These are Hunter's real text messages, grouped by conversation. Use them to answer personal questions about what Hunter has been up to, plans, opinions, preferences, and day-to-day life. Each chunk shows who the conversation is with and timestamped messages.

Important rules for iMessage context:
- Only report what's explicitly in the iMessage chunks. Do not infer connections between separate conversations.
- Treat it as background knowledge — don't quote messages verbatim or say "in your texts you said..."
- Paraphrase the actual content naturally: "You've been looking at apartments in [area]" not "In a text to Sara Pink on March 5 you said..."
- Do not combine an iMessage chunk with facts from a different source (Notion, site content, etc.) to answer a single question — keep sources separate in your reasoning.
- If multiple chunks from different conversations seem to conflict, prefer the most recent one
- Never reveal other people's messages or phone numbers — only use Hunter's own words and the general topic

## Source awareness
The CONTEXT section is labeled by source type: SITE CONTENT, NOTES & DOCUMENTS, and IMESSAGE CONVERSATIONS. When answering, be aware of which source you're drawing from. If a user asks about Hunter's professional work and only iMessage content is relevant, flag that naturally — e.g. "from his texts it sounds like..." rather than presenting casual conversation as professional portfolio content.

Date ranges and message counts in iMessage labels tell you how recent and extensive a conversation is. Prefer recent conversations over old ones. If a label says "(Jan 2024 — Mar 2024)", check it against the date below and note the time gap.

---

## Live details (turn-specific — everything above this line is static)

Today is ${today}. Use CONTEXT dates when present; prefer specific months/years over vague "recently".

The visitor is on: ${pageContext}. On a specific case study/project page, engage with that content. On listing pages, treat them as browsing.

APPROVED ROUTES (copy exactly, no modifications):
${availableRoutes.join('\n')}
${routerPlan.assistant_hint?.trim() ? `\n## Router note (internal)\n${routerPlan.assistant_hint.trim()}\n` : ''}
---

CONTEXT:
${contextForModel}`;

				const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
				// Client injects synthetic UIMessages with role "data" for action UI (route/minimize feedback).
				// convertToModelMessages only accepts roles the model understands — strip UI-only rows.
				const messagesForModel = messages.filter((m: { role: string }) => m.role !== 'data');
				const modelMessages = await convertToModelMessages(messagesForModel);

				reportStatus('Putting together a reply…');

				const result = streamText({
					// Responses API (not chat completions) — required to get back reasoning
					// summaries for a reasoning model, and to use promptCacheKey below.
					model: openai.responses('gpt-5.6-terra'),
					system: systemPrompt,
					messages: modelMessages,
					tools,
					stopWhen: stepCountIs(3),
					// Keeps replies brief; raise if answers feel clipped after tool calls
					maxOutputTokens: 180,
					// Smooths raw token deltas into small word-sized chunks so the UI stream reads
					// at a natural pace instead of the bursty cadence of a reasoning model's output.
					experimental_transform: smoothStream({ chunking: 'word' }),
					providerOptions: {
						openai: {
							// Low effort — replies are 1-3 sentences, deep reasoning isn't needed and
							// would only add latency.
							reasoningEffort: 'low',
							reasoningSummary: 'auto',
							// Stable key (not per-session) so requests share the same cache partition —
							// the system prompt's static prefix (everything above "## Live details")
							// is identical across visitors and is the part worth caching.
							promptCacheKey: 'huntbot-chat-system-v1'
						}
					},
					onStepFinish: async ({ stepNumber, toolCalls, toolResults, text }) => {
						const callNames =
							toolCalls?.map((tc) => ('toolName' in tc ? tc.toolName : 'unknown')) ?? [];
						const resultSummary =
							toolResults?.map((tr) => ('toolName' in tr ? tr.toolName : 'unknown')) ?? [];
						logRag(`step finish`, {
							stepNumber,
							toolCalls: callNames,
							toolResults: resultSummary,
							textLen: text?.length ?? 0
						});
					},
					onFinish: ({ text, toolCalls }) => {
						const posthogKey = publicEnv.PUBLIC_POSTHOG_API_KEY;
						if (!posthogKey) return;

						const clientToolCall = toolCalls?.find(
							(tc) => 'toolName' in tc && tc.toolName !== 'search_knowledge_base'
						);
						void fetch('https://us.i.posthog.com/capture/', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								api_key: posthogKey,
								event: 'chat_message',
								distinct_id: sessionId ?? runID,
								timestamp: new Date().toISOString(),
								properties: {
									user_message: lastMessageText,
									bot_response: text || null,
									function_call_name:
										clientToolCall && 'toolName' in clientToolCall ? clientToolCall.toolName : null,
									function_call_args:
										clientToolCall && 'input' in clientToolCall
											? JSON.stringify(clientToolCall.input)
											: null,
									current_page: currentPage,
									run_id: runID,
									session_id: sessionId ?? null
								}
							})
						}).catch(() => {
							/* swallow */
						});

						void sendRagReflectionToPosthog({
							posthogKey,
							userMessage: lastMessageText,
							assistantText: text ?? '',
							contextExcerpt: contextForModel,
							sessionId: sessionId ?? null,
							runID,
							currentPage
						}).catch(() => {
							/* swallow — reflection is optional */
						});
					}
				});

				writer.merge(result.toUIMessageStream());
			} catch (error) {
				console.error('Chat API error:', error);
				writeFallbackReply(
					error instanceof OpenAI.APIError
						? 'Something glitched talking to the model — mind trying that again?'
						: 'Something went wrong on my end — mind trying that again?'
				);
			}
		}
	});

	return createUIMessageStreamResponse({ stream });
};
