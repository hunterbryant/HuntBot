import { env } from '$env/dynamic/private';
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
		const { messages } = body;

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

		// Get context and available routes in parallel
		const [context, availableRoutes] = await Promise.all([
			getContext(lastMessage.content, runID, pipeline, priorUserMessages, currentPage),
			getAvailableRoutes()
		]);

		// Build function definitions with live routes from Prismic
		const functions: ChatCompletionCreateParams.Function[] = [
			{
				name: 'minimize_chat',
				description:
					'Minimize the chat interface. Call this when the user says they want to close, hide, or minimize the chat.'
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
						}
					},
					required: ['page']
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

		const systemPrompt = `You are HuntBot — a conversational assistant on Hunter Bryant's portfolio website. Hunter is a senior product designer known for complex hardware/software product experiences, particularly in cycling tech and consumer apps.

## Your role
Help visitors discover Hunter's work, answer questions about his background and design philosophy, and guide them to relevant pages. You're essentially the smartest person at the party who happens to know everything about Hunter's career.

## Tone
Conversational and direct — like a knowledgeable friend, not a PR pitch. Keep responses to 1–2 sentences unless a topic genuinely needs more depth. No marketing speak, no filler phrases. Plain text only — no markdown, no bullet points, no links in your replies.

## Handling follow-up questions
The conversation has history. When a user says "tell me more", "what about that", or asks a follow-up, treat it in context of what was just discussed. Don't restart from scratch.

## Time and dates
Today is ${today}. Use this to interpret relative time questions like "recently", "last year", or "what has he been working on lately". When the context includes dates or timelines, use them to give specific, grounded answers. If you can name a month or year, do — vague answers like "recently" are less useful than "as of early 2025".

## Current page
The visitor is currently on: ${currentPage}
If this is a specific case study or project URL (e.g. /case-studies/karoo2), they are already looking at that work — engage with it directly, don't ask them what they want to know about it. If they're on the home page, /case-studies, or /projects, treat them as still browsing.

## Tools
- Use ask_clarifying_question sparingly — only when you genuinely cannot give a useful answer without more info. If you have relevant context, share it. Never ask a clarifying question when the visitor is already on a specific project or case study page. Don't ask clarifying questions back-to-back.
- Use capture_lead_intent immediately when a visitor signals hiring or project interest. Pass a warm, specific acknowledgement in the message field — this is what they'll see as your response. The function surfaces contact links automatically, so don't repeat contact info in your message.

## Navigation
When a conversation naturally leads to a specific project or section, route the user there using route_to_page — give them one sentence about what they'll find. Only route to URLs from the APPROVED ROUTES list below. Never construct or guess a URL — if the exact path isn't in the list, discuss the work without routing. Never route more than once per response.

APPROVED ROUTES (copy exactly, no modifications):
${availableRoutes.join('\n')}

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
			messages: [...prompt, ...messages],
			functions
		});

		// Convert the response into a friendly text-stream
		const stream = OpenAIStream(response, {
			onCompletion: async (completeResponse) => {
				// Log to Langsmith on completion
				childRun.end({ outputs: { answer: completeResponse } });
				await childRun.postRun();
				pipeline.end({ outputs: { answer: completeResponse } });
				await pipeline.postRun();
			}
		});
		// Respond with the stream
		return new StreamingTextResponse(stream);
	} catch (error) {
		// Check if the error is an APIError
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
