/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import OpenAI from 'openai';

// Create an OpenAI API client
const openai = new OpenAI({
	apiKey: env.OPENAI_API_KEY || ''
});

export async function POST({ request }) {
	// Extract the `prompt` from the body of the request
	const { message } = await request.json();

	// Ask OpenAI for a streaming chat completion given the prompt
	const response = await openai.chat.completions.create({
		model: 'gpt-3.5-turbo',
		stream: false,
		messages: [
			{
				content: message,
				role: 'user'
			}
		]
	});

	return json(response['choices'][0]['message']['content']);

	// // Convert the response into a friendly text-stream
	// const stream = OpenAIStream(response);
	// // Respond with the stream
	// return new StreamingTextResponse(stream);
}
