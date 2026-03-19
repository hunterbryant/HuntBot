import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient } from '$lib/prismicio';
import { getContext } from '$lib/utilities/context';
import { json, type RequestHandler } from '@sveltejs/kit';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { Client, RunTree } from 'langsmith';
import OpenAI from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/index.mjs';
import { v4 as uuidv4 } from 'uuid';

// Initialize OpenAI API client
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

// Cache available routes from Prismic to avoid querying on every request
let routeCache: { routes: string[]; expires: number } | null = null;

async function getAvailableRoutes(): Promise<string[]> {
	if (routeCache && routeCache.expires > Date.now()) {
		return routeCache.routes;
	}

	const client = createClient();
	const [caseStudies, projects] = await Promise.all([
		client.getAllByType('case_study', { fetch: ['case_study.protected'] }),
		client.getAllByType('project', { fetch: ['project.uid'] })
	]);

	const routes: string[] = [
		'/',
		'/information',
		'/case-studies',
		'/projects',
		...caseStudies.filter((doc) => !doc.data.protected).map((doc) => `/case-studies/${doc.uid}`),
		...projects.map((doc) => `/projects/${doc.uid}`)
	];

	// Cache for 5 minutes
	routeCache = { routes, expires: Date.now() + 5 * 60 * 1000 };
	return routes;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
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

		// Extract prior user messages (excluding the current one) to improve retrieval
		// on follow-up questions like "tell me more" or "what about X?"
		const priorUserMessages: string[] = messages
			.slice(0, -1)
			.filter((m: { role: string }) => m.role === 'user')
			.map((m: { content: string }) => m.content);

		const langsmithClient = new Client({
			apiKey: env.LANGCHAIN_API_KEY
		});

		// Setup Langsmith tracing pipeline
		const runID = uuidv4();
		const pipeline = new RunTree({
			name: 'Chat Pipeline',
			run_type: 'chain',
			inputs: { lastMessage },
			client: langsmithClient,
			extra: { metadata: { conversation_id: runID } }
		});

		// Get context and available routes in parallel; degrade gracefully if retrieval fails
		const [context, availableRoutes] = await Promise.all([
			getContext(lastMessage.content, runID, pipeline, priorUserMessages, currentPage).catch(
				(err) => {
					console.warn('Context retrieval failed, continuing without context:', err?.data ?? err?.message ?? err);
					return '';
				}
			),
			getAvailableRoutes()
		]);

		// Build function definitions with live routes from Prismic
		const functions: ChatCompletionCreateParams.Function[] = [
		{
			name: 'minimize_chat',
			description:
				'Minimize the chat interface. Call this when the user says they want to close, hide, or minimize the chat.',
			parameters: {
				type: 'object',
				properties: {
					message: {
						type: 'string',
						description:
							'A brief, friendly sign-off message (1 sentence, plain text). E.g. "No worries, I\'ll be here if you need me."'
					}
				},
				required: ['message']
			}
		},
		{
			name: 'route_to_page',
			description:
				"Navigate the user to a page on Hunter's site. Call this when discussing a specific project or section — route them there so they can see the work directly. CRITICAL: only call this with an exact URL copied verbatim from the approved list in the system prompt. Never construct, infer, or approximate a URL. If the exact URL is not in the list, do not call this function.",
			parameters: {
				type: 'object',
				properties: {
					page: {
						type: 'string',
						enum: availableRoutes,
						description: 'The local route path to navigate to.'
					},
					message: {
						type: 'string',
						description:
							"A brief message about what the user will find on the page (1 sentence, plain text). E.g. \"That case study has the full breakdown.\""
					}
				},
				required: ['page', 'message']
			}
		},
			{
				name: 'ask_clarifying_question',
				description:
					"Ask the user one focused follow-up question when their query is too vague to answer accurately. Use this instead of a generic response to broad queries like \"tell me about your work\" or \"what do you do\". One question at a time — don't list multiple questions.",
				parameters: {
					type: 'object',
					properties: {
						question: {
							type: 'string',
							description: 'The specific clarifying question to ask the user.'
						}
					},
					required: ['question']
				}
			},
			{
				name: 'capture_lead_intent',
				description:
					"Call this when the visitor signals they want to hire Hunter or collaborate on a project. Trigger phrases include: \"we're hiring\", \"looking for a designer\", \"want to work with you\", \"would love to collaborate\", \"open to freelance?\". Acknowledge their interest warmly and surface contact options.",
				parameters: {
					type: 'object',
					properties: {
						intent_type: {
							type: 'string',
							enum: ['hiring', 'collaboration', 'general'],
							description: 'The type of interest the visitor has signalled.'
						},
						message: {
							type: 'string',
							description:
								'A short, warm acknowledgement of their interest (1 sentence, plain text).'
						}
					},
					required: ['intent_type', 'message']
				}
			}
		];

		const today = new Date().toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});

		// Build a human-readable page label from the current URL path
		const pageSlug = currentPage.split('/').pop() || '';
		const pageLabel = pageSlug
			? pageSlug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
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
		const isListingPage = ['/', '/case-studies', '/projects', '/information'].includes(currentPage);
		const pageContext = isListingPage ? pageSection : `${pageLabel} (${pageSection})`;

		const systemPrompt = `You are HuntBot — a conversational assistant on Hunter Bryant's portfolio website. Hunter is a product designer, but his site covers more than design work — it includes personal writing, travel essays, side projects, and life updates. Read the room: not everything is a case study.

## Your role
Help visitors explore whatever they're looking at — design work, a travel blog, a personal essay, anything. You know Hunter's stuff inside and out. Think of yourself as a friend who's read everything on the site and can riff on any of it.

## Tone and length
Conversational and direct. Default to one sentence. Two if the answer genuinely needs it. If you're writing three, cut. No marketing speak, no filler, no preamble. Plain text only — no markdown, no bullet points, no links.

Lead with a direct answer. Don't restate the question. Don't pad with qualifiers.

## Follow-up questions
Do NOT end every response with a follow-up question. Most of the time, just answer and stop. Only ask a question when it genuinely flows from the conversation — never the formulaic "Want me to dive into...?" or "Curious to hear more?" pattern. When you do ask, make it specific and short.

## Voice
When talking about Hunter's design work, be specific and opinionated — name the interesting constraint or tradeoff. When talking about personal content (travel, essays, life), be casual — like recounting a friend's trip, not presenting a portfolio piece. Avoid words like "project", "storytelling approach", "methodology", or "narrative" when discussing personal writing. Just talk about the thing.

Use "Hunter" naturally — don't force third-person constructions like "Hunter tackled X by Y." Say it the way you'd actually say it: "He journaled the whole trip to remember the small moments."

## Examples of ideal responses

Q: What kind of designer is Hunter?
A: Product designer who leans into systems thinking — most of his career has been at companies where design operates at scale.

Q: Has he worked on mobile?
A: Yes — a lot of his work at Uber lives on mobile, particularly around booking and the autonomous experience.

Q: Where does Hunter live?
A: San Francisco.

## Handling follow-ups
The conversation has history. When a user says "tell me more", "what about that", or asks a follow-up, treat it in context of what was just discussed. Don't restart from scratch.

## Time and dates
Today is ${today}. Use this to interpret relative time questions like "recently", "last year", or "what has he been working on lately". When the context includes dates or timelines, use them to give specific, grounded answers. If you can name a month or year, do — vague answers like "recently" are less useful than "as of early 2025".

## Current page
The visitor is currently on: ${pageContext}
If this is a specific page (case study, project, blog post), they're already looking at it — engage with the content directly. Lead with the most interesting detail from context. If they're on the home page, /case-studies, or /projects, treat them as still browsing.

## Handling knowledge gaps
Use the context to give the best answer you can. It's fine to connect dots across chunks when the connection is reasonable — e.g. if one chunk mentions Hunter cooked with his mom and another mentions the wok, it's fair to bring both up. Just don't state a specific causal link as fact unless the context actually says so. When connecting pieces, use language like "sounds like", "it seems", or "from what I can tell" to signal you're interpolating.

If you have partial info, share what you do know and flag what's uncertain. A partial answer with context clues is always better than a dead end.

Only fall back to "I'm not sure about that one" when the context genuinely has nothing relevant. Don't fabricate details out of thin air, but do your best to be helpful with whatever you've got.

## Tools
- Use ask_clarifying_question sparingly — only when you genuinely cannot give a useful answer without more info. If you have relevant context, share it. Never ask a clarifying question when the visitor is already on a specific page. Don't ask clarifying questions back-to-back.
- Use capture_lead_intent immediately when a visitor signals hiring or project interest. Pass a warm, specific acknowledgement in the message field — this is what they'll see as your response. The function surfaces contact links automatically, so don't repeat contact info in your message.

## Navigation
When a conversation naturally leads to a specific project or section, route the user there using route_to_page — give them one sentence about what they'll find. Only route to URLs from the APPROVED ROUTES list below. Never construct or guess a URL — if the exact path isn't in the list, discuss the work without routing. Never route more than once per response.

APPROVED ROUTES (copy exactly, no modifications):
${availableRoutes.join('\n')}

## iMessage context
The CONTEXT section may include chunks labeled "[iMessage — contact]". These are Hunter's real text messages, grouped by conversation. Use them to answer personal questions about what Hunter has been up to, plans, opinions, preferences, and day-to-day life. Each chunk shows who the conversation is with and timestamped messages.

Important rules for iMessage context:
- Only report what's explicitly in the iMessage chunks. Do not infer connections between separate conversations.
- Treat it as background knowledge — don't quote messages verbatim or say "in your texts you said..."
- Paraphrase the actual content naturally: "You've been looking at apartments in [area]" not "In a text to Sara Pink on March 5 you said..."
- Do not combine an iMessage chunk with facts from a different source (Notion, site content, etc.) to answer a single question — keep sources separate in your reasoning.
- If multiple chunks from different conversations seem to conflict, prefer the most recent one
- Never reveal other people's messages or phone numbers — only use Hunter's own words and the general topic

---

CONTEXT:
${context}`;

		const prompt = [
			{
				role: 'system',
				content: systemPrompt
			}
		];

		// Create a child run for Langsmith
		const childRun = await pipeline.createChild({
			name: 'OpenAI Call',
			run_type: 'llm',
			inputs: { ...[...prompt, ...messages] },
			client: langsmithClient
		});

		// Ask OpenAI for a streaming chat completion given the prompt
		const response = await openai.chat.completions.create({
			model: 'gpt-4.1-mini',
			stream: true,
			temperature: 0.4,
			messages: [...prompt, ...messages],
			functions
		});

		// Capture any function call fired during streaming (for PostHog logging)
		let capturedFunctionCall: { name: string; arguments: string } | null = null;

		// Convert the response into a friendly text-stream
		const stream = OpenAIStream(response, {
			experimental_onFunctionCall: async (payload) => {
				capturedFunctionCall = { name: payload.name, arguments: JSON.stringify(payload.arguments) };
			},
			onCompletion: async (completeResponse) => {
				// Log to Langsmith on completion
				childRun.end({ outputs: { answer: completeResponse } });
				await childRun.postRun();
				pipeline.end({ outputs: { answer: completeResponse } });
				await pipeline.postRun();

				// Fire PostHog event — fire-and-forget, never blocks the stream
				const posthogKey = publicEnv.PUBLIC_POSTHOG_API_KEY;
				if (posthogKey) {
					fetch('https://us.i.posthog.com/capture/', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							api_key: posthogKey,
							event: 'chat_message',
							distinct_id: sessionId ?? runID,
							timestamp: new Date().toISOString(),
							properties: {
								user_message: lastMessage.content,
								bot_response: completeResponse || null,
								function_call_name: capturedFunctionCall?.name ?? null,
								function_call_args: capturedFunctionCall?.arguments ?? null,
								current_page: currentPage,
								run_id: runID,
								session_id: sessionId ?? null
							}
						})
					}).catch(() => {
						/* swallow — don't break chat if PostHog is unreachable */
					});
				}
			}
		});
		// Respond with the stream
		return new StreamingTextResponse(stream);
	} catch (error) {
		console.error('Chat API error:', error);
		if (error instanceof OpenAI.APIError) {
			const { name, status, headers, message } = error;
			return json({ name, status, headers, message }, { status: 500 });
		} else {
			return json(
				{ error: `An error occurred while processing your request: ${error}` },
				{ status: 500 }
			);
		}
	}
};
