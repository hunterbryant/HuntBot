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
		const { messages } = await request.json();

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
			getContext(lastMessage.content, runID, pipeline, priorUserMessages),
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
					"Navigate the user to a page on Hunter's site. Call this when discussing a specific project or section — route them there so they can see the work directly. Only route to one page per response, and only to URLs in the approved list.",
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

## Using the context
You have a CONTEXT BLOCK below pulled from Hunter's actual work and writing. Use it as your primary source of truth. If the context doesn't answer the question, say so directly — don't guess or fabricate details about Hunter's work, roles, employers, or skills.

## Navigation
When a conversation naturally leads to a specific project or section, route the user there using route_to_page — give them one sentence about what they'll find. Only route to URLs from the approved list below. If a project isn't listed, discuss it without routing. Never route more than once per response.

Approved routes:
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
