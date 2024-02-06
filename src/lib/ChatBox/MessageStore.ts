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
			const parsedFunctionCallArguments = JSON.parse(functionCall.arguments);
			// You now have access to the parsed arguments here (assuming the JSON was valid)
			// If JSON is invalid, return an appropriate message to the model so that it may retry?

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
			// You now have access to the parsed arguments here (assuming the JSON was valid)
			// If JSON is invalid, return an appropriate message to the model so that it may retry?

			const functionMessage: FunctionMessage = {
				id: nanoid(),
				content: `Routing you to ${parsedFunctionCallArguments.page}`,
				role: 'function',
				name: functionCall.name,
				data: FunctionState.loading
			};

			setMessagesGlobal([...chatMessages, functionMessage]);
			setTimeout(() => {
				goto(`${parsedFunctionCallArguments.page}`);
				setTimeout(() => {
					setMessagesGlobal([...chatMessages, { ...functionMessage, data: FunctionState.success }]);
				}, 1000);
			}, 400);
		}
	} else {
		console.log('Unexpected function call: ', functionCall.name);
	}
};
