/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import OpenAI from 'openai';
import type { RequiredActionFunctionToolCall } from 'openai/resources/beta/threads/runs/runs.mjs';

// Create an OpenAI API client
const openai = new OpenAI({
	apiKey: env.OPENAI_API_KEY || ''
});

// Connect the HuntBot assistant
const assistant = await openai.beta.assistants.retrieve('asst_GUDei2ot5g45AVU3ovS1uLT1');

// Create the chat thread
const thread = await openai.beta.threads.create();

export async function POST({ request }) {
	// Extract the `prompt` from the body of the request
	const { message } = await request.json();

	// Add user message to the thread
	await openai.beta.threads.messages.create(thread.id, {
		role: 'user',
		content: message
	});

	// Run the HuntBot thread with the new message
	const run = await openai.beta.threads.runs.create(thread.id, {
		assistant_id: assistant.id
	});

	// Periodically retrieve the Run to check on its status to see if it has moved to completed
	const retrieveRun = async () => {
		let keepRetrievingRun;

		while (run.status !== 'completed') {
			keepRetrievingRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);

			switch (keepRetrievingRun.status) {
				case 'completed':
					console.log('Completed \n');
					return;
				case 'failed':
					console.log('Run failed');
					return;
				case 'requires_action':
					console.log('Requires action');
					await performAction(keepRetrievingRun.required_action?.submit_tool_outputs.tool_calls[0]);
					break;
			}
		}
	};

	// Perform any required actions requested by HuntBot
	const performAction = async (toolCall: RequiredActionFunctionToolCall) => {
		switch (toolCall.function.name) {
			case 'route_to_page':
				console.log('Routing to: ', JSON.parse(toolCall.function.arguments).page);
				break;
			case 'minimize_chat':
				console.log('Minimizing chat box');
				break;
			default:
				break;
		}

		await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
			tool_outputs: [
				{
					tool_call_id: toolCall.id,
					output: '{success: "true"}'
				}
			]
		});
	};

	// Step 6: Retrieve the Messages added by the Assistant to the Thread
	const waitForAssistantMessage = async () => {
		await retrieveRun();

		const allMessages = await openai.beta.threads.messages.list(thread.id);

		// let returnMessageCount = 0;
		// const returnMessages = [''];
		// const runStep = await openai.beta.threads.runs.steps.list(thread.id, run.id);
		// runStep.data.forEach((step) => {
		// 	if (step.type == 'message_creation') {
		// 		returnMessages.push(allMessages.data[0].content[returnMessageCount].text.value);
		// 		returnMessageCount++;
		// 	}
		// });

		// console.log(returnMessages);

		return allMessages.data[0].content[0].text.value;
	};

	return json(await waitForAssistantMessage());
}
