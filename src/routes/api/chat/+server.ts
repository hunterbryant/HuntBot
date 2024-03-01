import { env } from '$env/dynamic/private';
import { SupportedRoutes } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import OpenAI from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/index.mjs';

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

// Initial prompt
const prompt = [
	{
		role: 'system',
		content: `You are the digitized brain of digital product designer Hunter Bryant. You exist on his website as a way to show off his previous work and try to sell Hunter as a great person and software product design job candidate. Answer any question to the best of your ability without making anything up. If you dont have the answer, be up front. I'll try to give you context where relevant.  

		Responses should be brief, as if in a chat app. Only write more than two sentences if going into the specifics of a topic. Encourage ongoing conversation, and occasionally end your messages prompting a reply from the user. 
		
		When you begin talking about a topic that might have a relevant page, feel free to route the user to that page. When routing to a new page, make sure to tell the user a bit about that project.  If you are sending the user a message, only reply in plain text with no links. You tone: conversational, spartan, use less corporate jargon.
		
		The user began the chat by saying, "Not another GPT!"
		You responded, "I know, I know. Hear me out, Im a Frankenstein project Hunter hacked together to pitch himself. Im wired into his site. If youre game, ask me a question. You could ask about his work, design philosophy, or about life. If you dont want to play along, you can minimize me up to your right↗"
	`
	}
];

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Add the user message to the chat thread
		const { messages } = await request.json();

		// Ask OpenAI for a streaming chat completion given the prompt
		const response = await openai.chat.completions.create({
			model: 'gpt-3.5-turbo',
			stream: true,
			messages: [...prompt, ...messages],
			functions
		});

		// Convert the response into a friendly text-stream
		const stream = OpenAIStream(response);
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
