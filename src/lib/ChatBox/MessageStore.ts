import { goto } from '$app/navigation';
import { FunctionState, type FunctionMessage } from '$lib/types';
import type { FunctionCallHandler } from 'ai';
import { nanoid } from 'ai';
import { useChat, type Message } from 'ai/svelte';
import { writable } from 'svelte/store';

const greetingResponse: string =
	'I know, I know, another chatbot. Hear me out, I’m a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗';

const initMessage: Message = {
	id: 'initialmessage',
	content: ' ',
	role: 'assistant'
};

let setMessagesGlobal: (messages: Message[]) => void;

export const botEngaged = writable(false);
export const minimized = writable(true);

export const chat = () => {
	const { setMessages, ...chatProps } = useChat({
		initialMessages: [initMessage],
		id: 'uniquechatid',
		experimental_onFunctionCall: functionCallHandler
	});

	// Capture setMessages in a wider scope to be accessible by functionCallHandler
	setMessagesGlobal = setMessages;

	setTimeout(() => {
		setMessagesGlobal([{ ...initMessage, content: greetingResponse }]);
	}, 2000);

	return { setMessages, ...chatProps };
};

const functionCallHandler: FunctionCallHandler = async (chatMessages, functionCall) => {
	// Use setMessagesGlobal directly without needing to call chat()
	if (!setMessagesGlobal) {
		console.error('setMessages is not initialized.');
		return;
	}

	if (functionCall.name === 'minimize_chat') {
		if (functionCall.arguments) {
			const functionMessage: FunctionMessage = {
				id: nanoid(),
				content: 'Minimizing the chat',
				role: 'function',
				name: functionCall.name,
				data: FunctionState.loading
			};

			setMessagesGlobal([...chatMessages, functionMessage]);
			setTimeout(() => {
				setMessagesGlobal([...chatMessages, { ...functionMessage, data: FunctionState.success }]);
				setTimeout(() => {
					minimized.set(true);
				}, 1000);
			}, 1000);
		}
	} else if (functionCall.name === 'route_to_page') {
		if (functionCall.arguments) {
			const parsedFunctionCallArguments = JSON.parse(functionCall.arguments);

			// Navigate after a short delay
			setTimeout(() => {
				goto(`${parsedFunctionCallArguments.page}`);
			}, 400);

			// Return the function result directly — no separate setMessagesGlobal calls.
			// The data field drives the ActionMessage UI (success check), the content
			// is what the LLM receives as the function result to inform its follow-up.
			return {
				messages: [
					...chatMessages,
					{
						id: nanoid(),
						role: 'function' as const,
						name: functionCall.name,
						content: `Routed to ${parsedFunctionCallArguments.page}`,
						data: FunctionState.success
					} as FunctionMessage
				]
			};
		}
	} else if (functionCall.name === 'ask_clarifying_question') {
		if (functionCall.arguments) {
			const args = JSON.parse(functionCall.arguments);
			// Render the clarifying question as a normal bot message, not an action bubble
			setMessagesGlobal([
				...chatMessages,
				{
					id: nanoid(),
					role: 'assistant' as const,
					content: args.question ?? 'Could you tell me a bit more about what you're looking for?'
				}
			]);
		}
	} else if (functionCall.name === 'capture_lead_intent') {
		if (functionCall.arguments) {
			const args = JSON.parse(functionCall.arguments);
			return {
				messages: [
					...chatMessages,
					{
						id: nanoid(),
						role: 'function' as const,
						name: functionCall.name,
						content: args.message ?? "Sounds like you're interested in working with Hunter.",
						data: FunctionState.success
					} as FunctionMessage
				]
			};
		}
	} else {
		console.log('Unexpected function call: ', functionCall.name);
	}
};
