import { env } from '$env/dynamic/private';
import { SupportedRoutes } from '$lib/types';
import { getContext } from '$lib/utilities/context';
import { json, type RequestHandler } from '@sveltejs/kit';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { Client, RunTree } from 'langsmith';
import OpenAI from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/index.mjs';
import { v4 as uuidv4 } from 'uuid';

// Initialize OpenAI API client
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

// Function definition:
const functions: ChatCompletionCreateParams.Function[] = [
	{
		name: 'minimize_chat',
		description: 'Minimize the chat interface in which this thread is taking place.'
	},
	{
		name: 'route_to_page',
		description: 'Route the user to a local route on Hunters website. Only route to one at a time.',
		parameters: {
			type: 'object',
			properties: {
				page: {
					type: 'string',
					enum: Object.values(SupportedRoutes),
					description: 'The local route to use.'
				}
			},
			required: ['page']
		}
	}
];

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Add the user message to the chat thread
		const { messages } = await request.json();

		// Get the last message
		const lastMessage = messages[messages.length - 1];

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

		// Get the context from the reformatted response with specifics
		const context = await getContext(lastMessage.content, runID, pipeline);

		// Completion prompt
		const prompt = [
			{
				role: 'system',
				content: `You are an assistant on product designer Hunter Bryants website. You exist as a way to show off his previous work and try to sell Hunter as a great product design job candidate.

				Responses should be brief, in a chat app. Only write more than two sentences if going into the specifics of a topic. 
				
				When you begin talking about a topic that might have a relevant page, route the user to that page. When routing to a new page, make sure to tell the user a bit about that project.  If you are sending the user a message, only reply in plain text with no links. You tone: conversational, spartan, use less corporate jargon.

				Take into account any CONTEXT BLOCK that is provided in a conversation.
				If the context does not provide the answer to question, the say you don't know.

				START CONTEXT BLOCK
				${context}
				END OF CONTEXT BLOCK

				You will not apologize for previous responses, but instead will indicated new information was gained.
				You will NOT invent anything that is not drawn directly from the context. If you do not find the answer to a question in the context, be upfront that you do not know.
				You will NOT reply with any profanity.
				`
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
			model: 'gpt-3.5-turbo',
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
