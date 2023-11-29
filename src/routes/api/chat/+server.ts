import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import OpenAI from 'openai';
import type { RequiredActionFunctionToolCall } from 'openai/resources/beta/threads/runs/runs.mjs';

// Initialize OpenAI API client
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const assistantId = env.OPENAI_ASISTANT_ID;

// Create the chat thread
const thread = await openai.beta.threads.create();

export async function POST({ request }) {
	try {
		// Add the user message to the chat thread
		const { message } = await request.json();
		await openai.beta.threads.messages.create(thread.id, { role: 'user', content: message });

		// Run the thread and wait for completion
		const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: assistantId });
		await waitForRunCompletion(thread.id, run.id);

		// Retrieve and return the assistant's message
		const allMessages = await openai.beta.threads.messages.list(thread.id);
		if (allMessages.data[0].content[0].type == 'text') {
			return json(allMessages.data[0].content[0].text.value);
		} else {
			// Needed to silence TS errors and possible mysterious API responses from the LLM
			throw new Error('Expected text response, but received image_file');
		}
	} catch (error) {
		// Handle errors
		console.error('Error handling OpenAI API request: ', error);
		return json({ error: 'An error occurred while processing your request' }, { status: 500 });
	}
}

async function waitForRunCompletion(threadId: string, runId: string) {
	let runStatus;
	do {
		const run = await openai.beta.threads.runs.retrieve(threadId, runId);
		runStatus = run.status;

		if (runStatus === 'failed') {
			throw new Error('Run failed');
		} else if (runStatus === 'requires_action') {
			const toolOutputArray = [];

			// Perform required actions here
			for (const action of run.required_action!.submit_tool_outputs.tool_calls) {
				toolOutputArray.push(performAction(action));
			}

			// Respond to OpenAI with function status
			await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
				tool_outputs: toolOutputArray
			});
		}

		// Sleep for a short duration before checking again
		await new Promise((resolve) => setTimeout(resolve, 500));
	} while (runStatus !== 'completed');
	return;
}

function performAction(toolCall: RequiredActionFunctionToolCall) {
	if (toolCall.function.name == 'route_to_page') {
		// Handle route to page
		console.log('Routing to: ', JSON.parse(toolCall.function.arguments).page);
	} else if (toolCall.function.name == 'minimize_chat') {
		// Handle minimize chat
		console.log('Minimizing chat box');
	} else {
		// Handle errors
		console.log('Received unexpected tool call');
	}

	// Respond to OpenAI with function status
	return { tool_call_id: toolCall.id, output: '{success: "true"}' };
}
