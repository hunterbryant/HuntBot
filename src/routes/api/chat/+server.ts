import { env } from '$env/dynamic/private';
import { createChatEngine } from '$lib/ChatEngine/engine';
import { LlamaIndexStream } from '$lib/ChatEngine/llamaindex-stream';
import { json, type RequestHandler } from '@sveltejs/kit';
import { StreamingTextResponse } from 'ai';
import { OpenAI, type ChatMessage, type MessageContent } from 'llamaindex';

const convertMessageContent = (
	textMessage: string,
	imageUrl: string | undefined
): MessageContent => {
	if (!imageUrl) return textMessage;
	return [
		{
			type: 'text',
			text: textMessage
		},
		{
			type: 'image_url',
			image_url: {
				url: imageUrl
			}
		}
	];
};

// // Function definition:
// const minimizeChat = () => {
// 	console.log('Minimizing chat from the sevrer');
// };

// const minimizeJSON = {
// 	type: 'object',
// 	properties: {}
// };

// const minimizeFunctionTool = new FunctionTool(minimizeChat, {
// 	name: 'minimize_chat',
// 	description: 'Minimize the chat interface in which this thread is taking place.',
// 	parameters: minimizeJSON
// });

// const routeToPage = (page: string) => {
// 	console.log('On the server, routing to page: ', page);
// };

// const routeJSON = {
// 	type: 'object',
// 	properties: {
// 		page: {
// 			type: 'string',
// 			enum: Object.values(SupportedRoutes),
// 			description: 'The local route to use.'
// 		}
// 	},
// 	required: ['page']
// };

// const routeFunctionTool = new FunctionTool(routeToPage, {
// 	name: 'route_to_page',
// 	description: 'Route the user to a local route on Hunters website. Only route to one at a time.',
// 	parameters: routeJSON
// });

const llm = new OpenAI({
	model: 'gpt-3.5-turbo',
	maxTokens: 512,
	apiKey: env.OPENAI_API_KEY
});

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Add the user message to the chat thread
		const body = await request.json();
		const { messages }: { messages: ChatMessage[] } = body;
		const userMessage = messages.pop();

		if (!messages || !userMessage || userMessage.role !== 'user') {
			return json(
				{
					error:
						'messages are required in the request body and the last message must be from the user'
				},
				{ status: 400 }
			);
		}

		// const agent = new OpenAIAgent({
		// 	tools: [routeFunctionTool, minimizeFunctionTool],
		// 	verbose: true,
		// });

		const chatEngine = await createChatEngine(llm);

		// Convert message content from Vercel/AI format to LlamaIndex/OpenAI format
		const userMessageContent = convertMessageContent(userMessage.content, undefined);

		// Calling LlamaIndex's ChatEngine to get a streamed response
		const response = await chatEngine.chat({
			message: userMessageContent,
			chatHistory: messages,
			stream: true
		});

		// Transform LlamaIndex stream to Vercel/AI format
		const { stream, data: streamData } = LlamaIndexStream(response);

		// Respond with the stream
		return new StreamingTextResponse(stream, {}, streamData);
	} catch (error) {
		// Check if the error is an APIError
		console.error('[LlamaIndex]', error);
		return json(
			{ error: `An error occurred while processing your request: ${error}` },
			{ status: 500 }
		);
	}
};
