import { goto } from '$app/navigation';
import { captureEvent } from '$lib/analytics';
import { FunctionState, type FunctionMessage } from '$lib/types';
import type { FunctionCallHandler } from 'ai';
import { nanoid } from 'ai';
import { useChat, type Message } from 'ai/svelte';
import { writable } from 'svelte/store';

export const SESSION_ID = crypto.randomUUID();

export const suggestions = writable<string[]>([]);
export const scrollSuggestions = writable<string[]>([]);
export const hoverSuggestions = writable<string[]>([]);
export const loadingContextSuggestions = writable(false);

// Shared debounce + abort for hover/scroll context fetches so back-to-back
// triggers coalesce into a single request rather than racing each other.
let contextDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let contextFetchController: AbortController | null = null;

function scheduleContextFetch(fn: (signal: AbortSignal) => Promise<void>) {
	if (contextDebounceTimer) clearTimeout(contextDebounceTimer);
	if (contextFetchController) contextFetchController.abort();
	contextFetchController = new AbortController();
	const controller = contextFetchController;
	contextDebounceTimer = setTimeout(() => fn(controller.signal), 400);
}

export function cancelContextFetches() {
	if (contextDebounceTimer) clearTimeout(contextDebounceTimer);
	if (contextFetchController) contextFetchController.abort();
	contextDebounceTimer = null;
	contextFetchController = null;
	loadingContextSuggestions.set(false);
}

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

export function fetchScrollSuggestions(
	currentPage: string,
	scrollDepth: number,
	sectionHeading: string | null
): void {
	// Only show the loading state when tied to a specific section heading — the
	// initial mount fetch and scroll-depth-only fetches produce generic suggestions
	// that aren't tailored enough to warrant surfacing the placeholder transition.
	const isContextual = sectionHeading !== null;

	scheduleContextFetch(async (signal) => {
		if (isContextual) loadingContextSuggestions.set(true);
		try {
			const response = await fetch('/api/chat/suggestions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: [], currentPage, scrollDepth, sectionHeading }),
				signal
			});
			if (response.ok) {
				const data = await response.json();
				const suggs: string[] = data.suggestions ?? [];
				scrollSuggestions.set(suggs);
				if (suggs.length > 0) {
					captureEvent('suggestions_shown', SESSION_ID, {
						suggestion_type: 'scroll',
						suggestions: suggs,
						current_page: currentPage,
						session_id: SESSION_ID
					});
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				// Silently fail — scroll suggestions are best-effort; keep last good set
			}
		} finally {
			if (isContextual) loadingContextSuggestions.set(false);
		}
	});
}

export function fetchHoverSuggestions(currentPage: string, hoveredContent: string): void {
	scheduleContextFetch(async (signal) => {
		loadingContextSuggestions.set(true);
		try {
			const response = await fetch('/api/chat/suggestions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: [], currentPage, hoveredContent }),
				signal
			});
			if (response.ok) {
				const data = await response.json();
				const suggs: string[] = data.suggestions ?? [];
				hoverSuggestions.set(suggs);
				if (suggs.length > 0) {
					captureEvent('suggestions_shown', SESSION_ID, {
						suggestion_type: 'hover',
						suggestions: suggs,
						current_page: currentPage,
						session_id: SESSION_ID
					});
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				// Silently fail — hover suggestions are best-effort
			}
		} finally {
			loadingContextSuggestions.set(false);
		}
	});
}

export async function fetchSuggestions(messages: Message[], currentPage: string): Promise<void> {
	// Cancel any pending context fetch — post-response suggestions take priority
	cancelContextFetches();
	scrollSuggestions.set([]);
	hoverSuggestions.set([]);
	try {
		const response = await fetch('/api/chat/suggestions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages, currentPage })
		});
		if (response.ok) {
			const data = await response.json();
			const suggs: string[] = data.suggestions ?? [];
			suggestions.set(suggs);
			if (suggs.length > 0) {
				captureEvent('suggestions_shown', SESSION_ID, {
					suggestion_type: 'post_message',
					suggestions: suggs,
					current_page: currentPage,
					session_id: SESSION_ID
				});
			}
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
		body: { sessionId: SESSION_ID },
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

	// Strip the empty-content assistant message the SDK creates for function calls
	const baseMessages = chatMessages.filter(
		(m) => !(m.role === 'assistant' && !m.content?.trim() && 'function_call' in m)
	);

	if (functionCall.name === 'minimize_chat') {
		if (functionCall.arguments) {
			const args = JSON.parse(functionCall.arguments);
			const textMessage: Message = {
				id: nanoid(),
				role: 'assistant' as const,
				content: args.message ?? "I'll be here if you need me."
			};
			const functionMessage: FunctionMessage = {
				id: nanoid(),
				content: 'Minimizing the chat',
				role: 'function',
				name: functionCall.name,
				data: FunctionState.loading
			};

			setMessagesGlobal([...baseMessages, textMessage, functionMessage]);
			setTimeout(() => {
				setMessagesGlobal([
					...baseMessages,
					textMessage,
					{ ...functionMessage, data: FunctionState.success }
				]);
				setTimeout(() => {
					minimized.set(true);
				}, 1000);
			}, 1000);
		}
	} else if (functionCall.name === 'route_to_page') {
		if (functionCall.arguments) {
			const args = JSON.parse(functionCall.arguments);
			const textMessage: Message = {
				id: nanoid(),
				role: 'assistant' as const,
				content: args.message ?? `Taking you to ${args.page}.`
			};

			setMessagesGlobal([
				...baseMessages,
				textMessage,
				{
					id: nanoid(),
					role: 'function' as const,
					name: functionCall.name,
					content: `Routed to ${args.page}`,
					data: FunctionState.success
				} as FunctionMessage
			]);

			setTimeout(() => {
				goto(`${args.page}`);
			}, 400);
		}
	} else if (functionCall.name === 'ask_clarifying_question') {
		if (functionCall.arguments) {
			const args = JSON.parse(functionCall.arguments);
			setMessagesGlobal([
				...baseMessages,
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
			const warmMessage = args.message ?? "Sounds like you're interested in working with Hunter.";
			setMessagesGlobal([
				...baseMessages,
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
