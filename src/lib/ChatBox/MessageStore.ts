import { goto } from '$app/navigation';
import { FunctionState, type FunctionMessage } from '$lib/types';
import type { FunctionCallHandler } from 'ai';
import { nanoid } from 'ai';
import { useChat, type Message } from 'ai/svelte';
import { writable } from 'svelte/store';

export const suggestions = writable<string[]>([]);

export async function triggerProactiveOpener(
	currentMessages: Message[],
	currentPage: string
): Promise<void> {
	try {
		const response = await fetch('/api/chat/proactive', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ currentPage })
		});
		if (response.ok) {
			const data = await response.json();
			if (data.message && setMessagesGlobal) {
				setMessagesGlobal([
					...currentMessages,
					{
						id: 'proactive-' + Date.now(),
						role: 'assistant' as const,
						content: data.message
					}
				]);
			}
		}
	} catch {
		// Silently fail — proactive opener is best-effort
	}
}

export async function fetchSuggestions(messages: Message[], currentPage: string): Promise<void> {
	try {
		const response = await fetch('/api/chat/suggestions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages, currentPage })
		});
		if (response.ok) {
			const data = await response.json();
			suggestions.set(data.suggestions ?? []);
		}
	} catch {
		suggestions.set([]);
	}
}

const greetingResponse: string =
	"I know, I know, another chatbot. Hear me out, I'm a Frankenstein project Hunter hacked together to pitch himself. I'm wired into his site.\nIf you're game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don't want to play along, you can minimize me up to your right↗";

const initMessage: Message = {
	id: 'initialmessage',
	content: ' ',
	role: 'assistant'
};

let setMessagesGlobal: (messages: Message[]) => void;

export const botEngaged = writable(false);
export const minimized = writable(true);

export const chat = () => {
	const { setMessages, append, messages, ...chatProps } = useChat({
		initialMessages: [initMessage],
		id: 'uniquechatid',
		experimental_onFunctionCall: functionCallHandler
	});

	// Capture setMessages in a wider scope to be accessible by functionCallHandler
	setMessagesGlobal = setMessages;

	setTimeout(() => {
		setMessagesGlobal([{ ...initMessage, content: greetingResponse }]);
	}, 2000);

	return { setMessages, append, messages, ...chatProps };
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

			const updatedMessages = [
				...chatMessages,
				{
					id: nanoid(),
					role: 'function' as const,
					name: functionCall.name,
					content: `Routed to ${parsedFunctionCallArguments.page}`,
					data: FunctionState.success
				} as FunctionMessage
			];

			// Update the store immediately so ActionMessage renders before navigation
			setMessagesGlobal(updatedMessages);

			setTimeout(() => {
				goto(`${parsedFunctionCallArguments.page}`);
			}, 400);

			// Return the same messages so the SDK makes a follow-up LLM call,
			// allowing the bot to say something after navigating.
			return { messages: updatedMessages };
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
					content: args.question ?? "Could you tell me a bit more about what you're looking for?"
				}
			]);
		}
	} else if (functionCall.name === 'capture_lead_intent') {
		if (functionCall.arguments) {
			const args = JSON.parse(functionCall.arguments);
			// Render the warm message as a normal bot message, then show the contact card
			// separately. Using setMessagesGlobal (no return) prevents a redundant LLM follow-up.
			const warmMessage = args.message ?? "Sounds like you're interested in working with Hunter.";
			setMessagesGlobal([
				...chatMessages,
				{
					id: nanoid(),
					role: 'assistant' as const,
					content: warmMessage
				},
				{
					id: nanoid(),
					role: 'function' as const,
					name: functionCall.name,
					content: '',
					data: FunctionState.success
				} as FunctionMessage
			]);
		}
	} else {
		console.log('Unexpected function call: ', functionCall.name);
	}
};
