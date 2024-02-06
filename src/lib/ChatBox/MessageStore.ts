import { goto } from '$app/navigation';
import type { FunctionCallHandler } from 'ai';
import { useChat, type Message } from 'ai/svelte';
import { writable } from 'svelte/store';

const greetingResponse: string =
	'I know, I know, another chatbot. Hear me out, I’m a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗';

const initMessage: Message = {
	id: '0123',
	content: greetingResponse,
	role: 'assistant'
};

export const botEngaged = writable(false);
export const chat = () => {
	return useChat({
		initialMessages: [initMessage],
		id: '123',
		experimental_onFunctionCall: functionCallHandler
	});
};

const functionCallHandler: FunctionCallHandler = async (chatMessages, functionCall) => {
	if (functionCall.name === 'minimize_chat') {
		if (functionCall.arguments) {
			const parsedFunctionCallArguments = JSON.parse(functionCall.arguments);
			// You now have access to the parsed arguments here (assuming the JSON was valid)
			// If JSON is invalid, return an appropriate message to the model so that it may retry?
			console.log(parsedFunctionCallArguments);
		}
	} else if (functionCall.name === 'route_to_page') {
		if (functionCall.arguments) {
			const parsedFunctionCallArguments = JSON.parse(functionCall.arguments);
			// You now have access to the parsed arguments here (assuming the JSON was valid)
			// If JSON is invalid, return an appropriate message to the model so that it may retry?

			console.log(parsedFunctionCallArguments);
			goto(`${parsedFunctionCallArguments.page}`);
		}
	} else {
		console.log('Unexpected function call: ', functionCall.name);
	}
};
