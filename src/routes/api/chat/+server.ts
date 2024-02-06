import { env } from '$env/dynamic/private';
import { SupportedRoutes } from '$lib/types';
import { json, type RequestHandler } from '@sveltejs/kit';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import OpenAI from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/index.mjs';

// Initialize OpenAI API client
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export const config = {
	runtime: 'edge'
};

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

		// Ask OpenAI for a streaming chat completion given the prompt
		const response = await openai.chat.completions.create({
			model: 'gpt-3.5-turbo',
			stream: true,
			messages,
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
