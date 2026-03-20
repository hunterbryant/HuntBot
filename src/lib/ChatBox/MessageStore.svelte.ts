import { goto } from '$app/navigation';
import { captureEvent } from '$lib/analytics';
import { FunctionState, type FunctionMessage } from '$lib/types';
import { Chat, type UIMessage } from '@ai-sdk/svelte';
import { generateId, DefaultChatTransport } from 'ai';
import { toStore, writable } from 'svelte/store';

// Re-export UIMessage as Message for backward compat with consuming code
export type { UIMessage as Message };

function getOrCreateSessionId(): string {
	const key = 'huntbot_session_id';
	const existing = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
	if (existing) return existing;
	const id = crypto.randomUUID();
	if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, id);
	return id;
}

export const SESSION_ID = getOrCreateSessionId();

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
	currentMessages: UIMessage[],
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
			if (data.message && chatInstance) {
				chatInstance.messages = [
					...currentMessages,
					{
						id: 'proactive-' + Date.now(),
						role: 'assistant' as const,
						parts: [{ type: 'text' as const, text: data.message }]
					}
				];
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

export async function fetchSuggestions(messages: UIMessage[], currentPage: string): Promise<void> {
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
	"I know, another chatbot. But I'm wired into Hunter's site — ask me about his work, design philosophy, or life.\nNot interested? Minimize me up to your right↗";

const initMessage: UIMessage = {
	id: 'initialmessage',
	role: 'assistant',
	parts: [{ type: 'text', text: ' ' }]
};

let chatInstance: Chat | null = null;

export const botEngaged = writable(false);
export const minimized = writable(true);

// Helper to extract text from a UIMessage's parts
export function getMessageText(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

export const chat = () => {
	const instance = new Chat({
		id: 'uniquechatid',
		messages: [initMessage],
		transport: new DefaultChatTransport({
			api: '/api/chat',
			body: { sessionId: SESSION_ID }
		}),
		onToolCall: async ({ toolCall }) => {
			// In v6, tool call has toolName + input (not args)
			const tc = toolCall as unknown as { toolCallId: string; toolName: string; input: Record<string, unknown> };
			handleToolCall({ toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.input });
		}
	});

	chatInstance = instance;

	setTimeout(() => {
		instance.messages = [{ ...initMessage, parts: [{ type: 'text', text: greetingResponse }] }];
	}, 2000);

	// Bridge reactive Chat properties to Svelte stores for backward compat
	const messages = toStore(() => instance.messages);
	const isLoading = toStore(() => instance.status === 'streaming' || instance.status === 'submitted');
	const input = writable('');

	function handleSubmit(event?: { preventDefault?: () => void }) {
		event?.preventDefault?.();
		let value = '';
		input.update((v) => { value = v; return ''; });
		if (value.trim()) {
			instance.sendMessage({ text: value.trim() });
		}
	}

	async function append(message: { role: string; content: string }) {
		if (message.role === 'user') {
			await instance.sendMessage({ text: message.content });
		}
	}

	function setMessages(msgs: UIMessage[]) {
		instance.messages = msgs;
	}

	return { messages, isLoading, handleSubmit, input, append, setMessages };
};

function handleToolCall(
	toolCall: { toolCallId: string; toolName: string; args: Record<string, unknown> }
) {
	if (!chatInstance) {
		console.error('Chat instance not initialized.');
		return;
	}

	const currentMessages = chatInstance.messages;

	// Strip assistant messages that are purely tool invocations with no text content
	const baseMessages = currentMessages.filter(
		(m) =>
			!(
				m.role === 'assistant' &&
				!m.parts.some((p) => p.type === 'text' && 'text' in p && (p as { text: string }).text.trim()) &&
				m.parts.some((p) => p.type === 'tool-invocation')
			)
	);

	if (toolCall.toolName === 'minimize_chat') {
		const args = toolCall.args as { message: string };
		const textMessage: UIMessage = {
			id: generateId(),
			role: 'assistant',
			parts: [{ type: 'text', text: args.message ?? "I'll be here if you need me." }]
		};
		const functionMessage: FunctionMessage = {
			id: generateId(),
			content: 'Minimizing the chat',
			role: 'data',
			name: toolCall.toolName,
			data: FunctionState.loading,
			parts: []
		};

		chatInstance.messages = [...baseMessages, textMessage, functionMessage as unknown as UIMessage];
		setTimeout(() => {
			if (!chatInstance) return;
			chatInstance.messages = [
				...baseMessages,
				textMessage,
				{ ...functionMessage, data: FunctionState.success } as unknown as UIMessage
			];
			setTimeout(() => {
				minimized.set(true);
			}, 1000);
		}, 1000);
	} else if (toolCall.toolName === 'route_to_page') {
		const args = toolCall.args as { page: string; message: string };
		const textMessage: UIMessage = {
			id: generateId(),
			role: 'assistant',
			parts: [{ type: 'text', text: args.message ?? `Taking you to ${args.page}.` }]
		};

		chatInstance.messages = [
			...baseMessages,
			textMessage,
			{
				id: generateId(),
				role: 'data' as UIMessage['role'],
				content: `Routed to ${args.page}`,
				name: toolCall.toolName,
				data: FunctionState.success,
				parts: []
			} as unknown as UIMessage
		];

		setTimeout(() => {
			goto(`${args.page}`);
		}, 400);
	} else if (toolCall.toolName === 'ask_clarifying_question') {
		const args = toolCall.args as { question: string };
		chatInstance.messages = [
			...baseMessages,
			{
				id: generateId(),
				role: 'assistant',
				parts: [{ type: 'text', text: args.question ?? "Could you tell me a bit more about what you're looking for?" }]
			}
		];
	} else if (toolCall.toolName === 'capture_lead_intent') {
		const args = toolCall.args as { intent_type: string; message: string };
		const warmMessage = args.message ?? "Sounds like you're interested in working with Hunter.";
		chatInstance.messages = [
			...baseMessages,
			{
				id: generateId(),
				role: 'assistant',
				parts: [{ type: 'text', text: warmMessage }]
			},
			{
				id: generateId(),
				role: 'data' as UIMessage['role'],
				content: '',
				name: toolCall.toolName,
				data: FunctionState.success,
				parts: []
			} as unknown as UIMessage
		];
	} else {
		console.log('Unexpected tool call: ', toolCall.toolName);
	}
}
