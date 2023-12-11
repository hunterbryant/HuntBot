import { env } from '$env/dynamic/private';
import { SupportedActions, type BotAction } from '$lib/types.d.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import OpenAI from 'openai';
import type { RequiredActionFunctionToolCall } from 'openai/resources/beta/threads/runs/runs.mjs';

// Initialize OpenAI API client
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const assistantId = env.OPENAI_ASISTANT_ID;

export const POST: RequestHandler = async({ request }) => {
	try {
		// Add the user message to the chat thread
		const { message, sessionId } = await request.json();

		// Configure thread
		let thread: OpenAI.Beta.Thread;
		if (sessionId) {
			// Retreive the existing thread
			thread = await openai.beta.threads.retrieve(sessionId);
		} else {
			// Start a new thread
			thread = await openai.beta.threads.create();
		}

		// Add message to thread
		await openai.beta.threads.messages.create(thread.id, { role: 'user', content: message });

		// Run the thread and wait for completion
		const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: assistantId });
		const actionsPerformed: Array<BotAction> = [];
		await waitForRunCompletion(thread.id, run.id, actionsPerformed);

		// Retrieve and return the assistant's message
		const allMessages = await openai.beta.threads.messages.list(thread.id);
		if (allMessages.data[0].content[0].type == 'text') {
			return json({
				threadId: thread.id,
				message: allMessages.data[0].content[0].text.value,
				actions: actionsPerformed
			});
		} else {
			// Needed to silence TS errors for possible mysterious API responses from Open AI
			throw new Error('Expected text response, but received image_file');
		}
	} catch (error) {
		console.error('Error handling OpenAI API request: ', error);
		return json({ error: 'An error occurred while processing your request' }, { status: 500 });
	}
}

async function waitForRunCompletion(
	threadId: string,
	runId: string,
	actionsPerformed: BotAction[]
) {
	let runStatus;
	do {
		const run = await openai.beta.threads.runs.retrieve(threadId, runId);
		runStatus = run.status;

		if (runStatus === 'failed') {
			throw new Error(run.last_error?.message);
		} else if (runStatus === 'requires_action') {
			const toolOutputArray = [];

			// Perform required actions here
			for (const action of run.required_action!.submit_tool_outputs.tool_calls) {
				toolOutputArray.push(performAction(action, actionsPerformed));
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

function performAction(toolCall: RequiredActionFunctionToolCall, actionsPerformed: BotAction[]) {
	// See if the funciton is valid
	if (toolCall.function.name in SupportedActions) {
		actionsPerformed.push({
			name: toolCall.function.name as SupportedActions,
			arguments: JSON.parse(toolCall.function.arguments)
		});

		// Respond to OpenAI with function status
		return { tool_call_id: toolCall.id, output: JSON.stringify({ success: 'true' }) };
	} else {
		// Handle errors
		console.log('Received unexpected tool call');

		// Respond to OpenAI with function status
		return { tool_call_id: toolCall.id, output: JSON.stringify({ success: 'false' }) };
	}
}
