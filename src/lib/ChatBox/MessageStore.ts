import { goto } from '$app/navigation';
import { FunctionState, type FunctionMessage } from '$lib/types';
import type { FunctionCallHandler } from 'ai';
import { nanoid } from 'ai';
import { useChat, type Message } from 'ai/svelte';
import { get, writable } from 'svelte/store';

const greetingResponse: string =
	'I know, I know, another chatbot. Hear me out, I'm a Frankenstein project Hunter hacked together to pitch himself. I'm wired into his site.\nIf you're game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don't want to play along, you can minimize me up to your right↗';

const initMessage: Message = {
	id: 'initialmessage',
	content: ' ',
	role: 'assistant'
};

let setMessagesGlobal: (messages: Message[]) => void;
let appendGlobal: (message: { role: 'user'; content: string }, options?: { body?: Record<string, unknown> }) => Promise<string | null | undefined>;

export const botEngaged = writable(false);
export const minimized = writable(true);
export const suggestedResponses = writable<string[]>([]);

async function fetchSuggestions(messages: Message[]): Promise<string[]> {
	try {
		const res = await fetch('/api/suggestions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messages: messages
					.filter((m) => m.role === 'user' || m.role === 'assistant')
					.slice(-6)
					.map((m) => ({ role: m.role, content: m.content }))
			})
		});
		if (!res.ok) return [];
		const { suggestions } = await res.json();
		return Array.isArray(suggestions) ? suggestions : [];
	} catch {
		return [];
	}
}

export const chat = () => {
	const { setMessages, append, messages, ...chatProps } = useChat({
		initialMessages: [initMessage],
		id: 'uniquechatid',
		experimental_onFunctionCall: functionCallHandler,
		onFinish: (message) => {
			if (message.role === 'assistant' && message.content.trim()) {
				suggestedResponses.set([]);
				const currentMessages = get(messages);
				fetchSuggestions(currentMessages).then((s) => suggestedResponses.set(s));
			}
		}
	});

	// Capture setMessages and append in a wider scope to be accessible by functionCallHandler
	setMessagesGlobal = setMessages;
	appendGlobal = append;

	setTimeout(() => {
		setMessagesGlobal([{ ...initMessage, content: greetingResponse }]);
	}, 2000);

	return { setMessages, append, messages, ...chatProps };
};

export const submitSuggestion = (text: string, currentPage: string) => {
	if (appendGlobal) {
		suggestedResponses.set([]);
		minimized.set(false);
		appendGlobal({ role: 'user', content: text }, { body: { currentPage } });
	}
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
