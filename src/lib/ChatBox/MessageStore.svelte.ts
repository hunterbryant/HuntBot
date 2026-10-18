import { goto } from '$app/navigation';
import { captureEvent } from '$lib/analytics';
import { FunctionState, type FunctionMessage } from '$lib/types';
import {
	getSimulatedOrg,
	getVisitorContext,
	setSimulatedOrg,
	setStatedCompany
} from '$lib/visitorContext';
import { Chat, type UIMessage } from '@ai-sdk/svelte';
import { DefaultChatTransport, generateId } from 'ai';
import { get, toStore, writable } from 'svelte/store';

// Re-export UIMessage as Message for backward compat with consuming code
export type { UIMessage as Message };

const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_KEY = 'huntbot_session_id';
const CHAT_KEY = 'huntbot_chat_v1';
const MAX_SAVED_MESSAGES = 50;

// True when a still-valid session id already existed before this page load (a returning visitor).
let sessionWasReturning = false;

// Lives in localStorage so a conversation resumed after closing the browser keeps one session id
// (PostHog joins on it). Expires after 7 days of inactivity, like the saved chat.
function getOrCreateSessionId(): string {
	if (typeof window === 'undefined') return crypto.randomUUID();
	try {
		const raw = localStorage.getItem(SESSION_KEY);
		if (raw) {
			const { id, at } = JSON.parse(raw) as { id?: string; at?: number };
			if (id && typeof at === 'number' && Date.now() - at < STORAGE_TTL_MS) {
				sessionWasReturning = true;
				localStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: Date.now() }));
				return id;
			}
		}
		const id = sessionStorage.getItem(SESSION_KEY) || crypto.randomUUID();
		localStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: Date.now() }));
		return id;
	} catch {
		return crypto.randomUUID();
	}
}

export const SESSION_ID = getOrCreateSessionId();
export const SESSION_RETURNING = sessionWasReturning;

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

const ROLE_OPENER_KEY = 'huntbot_role_opener_v1';

type RoleOpenerData = { message?: string; options?: unknown[]; teaser?: string; reason?: string };

/** Short line the minimized chat bar shows once the opener is ready (null: nothing to say). */
export const roleTeaser = writable<string | null>(null);
/** True for a few seconds after the teaser lands, so it beats whatever suggestion is showing. */
export const roleTeaserHold = writable(false);
const TEASER_HOLD_MS = 10_000;

async function requestRoleOpener(simulate?: string): Promise<RoleOpenerData | null> {
	try {
		const response = await fetch('/api/chat/role-opener', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				visitor: getVisitorContext(),
				simulateOrg: simulate ?? getSimulatedOrg() ?? undefined
			})
		});
		return response.ok ? await response.json() : null;
	} catch {
		// best-effort, like the page opener
		return null;
	}
}

const hasUserMessage = () => (chatInstance?.messages ?? []).some((m) => m.role === 'user');
const isRoleOpener = (m: UIMessage) => String(m.id).startsWith('role-opener-');

/**
 * Looks the visitor's company and open roles up while the chat is still closed, so the minimized
 * bar can tease it (`roleTeaser`) and opening the chat shows the question at once. Once per
 * browser session; the server returns nothing under Global Privacy Control or for non-company
 * networks.
 */
export function prefetchRoleOpener(): void {
	if (roleOpenerPromise || roleOpenerAsked || hasUserMessage()) return;
	try {
		if (sessionStorage.getItem(ROLE_OPENER_KEY)) return;
		sessionStorage.setItem(ROLE_OPENER_KEY, '1');
	} catch {
		// storage blocked: ask at most once per page load instead
	}
	roleOpenerPromise = requestRoleOpener();
	void roleOpenerPromise.then((data) => {
		// The chat may have opened (and posted the opener) while the lookup ran.
		if (!data?.message || !data.teaser || !get(minimized) || hasUserMessage()) return;
		roleTeaser.set(data.teaser);
		// The "Any questions?" bar turns into the input bar, which carries the teaser.
		botEngaged.set(true);
		roleTeaserHold.set(true);
		setTimeout(() => roleTeaserHold.set(false), TEASER_HOLD_MS);
		captureEvent('role_teaser_shown', SESSION_ID, { session_id: SESSION_ID });
	});
}

/**
 * The first time the chat opens with no conversation: if the visitor's network is a company with
 * open design roles, HuntBot asks whether they're hiring for one. Uses the early lookup when
 * there is one, and then starts the conversation with that question instead of the greeting.
 */
export async function triggerRoleOpener(simulate?: string): Promise<void> {
	if (!simulate) {
		if (roleOpenerPosted) return;
		if (!roleOpenerPromise) {
			// `/simulate` always asks again; otherwise once per browser session
			try {
				if (sessionStorage.getItem(ROLE_OPENER_KEY)) return;
				sessionStorage.setItem(ROLE_OPENER_KEY, '1');
			} catch {
				// storage blocked: ask at most once per page load instead
				if (roleOpenerAsked) return;
			}
			roleOpenerPromise = requestRoleOpener();
		}
	}
	roleOpenerAsked = true;
	// Only the newest call may post: a simulate and the on-open trigger can start together.
	const run = ++roleOpenerRun;
	const stale = () => run !== roleOpenerRun;
	const withoutOpeners = () => (chatInstance?.messages ?? []).filter((m) => !isRoleOpener(m));
	const data = await (simulate ? requestRoleOpener(simulate) : roleOpenerPromise);
	if (!chatInstance || stale()) return;
	if (!data?.message) {
		if (simulate) {
			chatInstance.messages = [
				...withoutOpeners(),
				{
					id: 'role-opener-' + Date.now(),
					role: 'assistant' as const,
					parts: [
						{
							type: 'text' as const,
							text:
								data?.reason === 'rate_limited'
									? 'Too many simulations from here, try again in a few minutes.'
									: `Simulating ${simulate}, but I couldn't find open design roles there.`
						}
					]
				}
			];
		}
		return;
	}
	// The visitor may have typed while the lookup ran; then the chat route's own prompt asks.
	if (hasUserMessage()) return;
	roleOpenerPosted = true;
	roleTeaser.set(null);
	roleTeaserHold.set(false);
	chatInstance.messages = [
		// The question is the greeting: drop the canned one if it already landed.
		...withoutOpeners().filter((m) => m.id !== initMessage.id),
		{
			id: 'role-opener-' + Date.now(),
			role: 'assistant' as const,
			parts: [
				{ type: 'text' as const, text: data.message },
				...(Array.isArray(data.options) && data.options.length
					? [{ type: 'data-options' as const, data: { options: data.options } }]
					: [])
			] as UIMessage['parts']
		}
	];
	captureEvent('role_opener_shown', SESSION_ID, { session_id: SESSION_ID });
}

let roleOpenerAsked = false;
let roleOpenerPosted = false;
let roleOpenerPromise: Promise<RoleOpenerData | null> | null = null;
let roleOpenerRun = 0;

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
					suggestion_type: messages.some((m) => m.role === 'user') ? 'post_message' : 'starter',
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
	"Yeah, another chatbot — I know. But I'm wired into Hunter's site, so I can actually talk about the work. Ask me anything.";

const initMessage: UIMessage = {
	id: 'initialmessage',
	role: 'assistant',
	parts: [{ type: 'text', text: ' ' }]
};

let chatInstance: Chat | null = null;

/** Ids of messages restored from storage, so the UI doesn't replay their reveal animation. */
export const restoredMessageIds = new Set<string>();

const SAVED_PART_TYPES = new Set(['text', 'source-url', 'data-related', 'data-options']);

/** Only what's worth showing again: replies, sources, related chips and the contact card. */
function sanitizeForStorage(messages: UIMessage[]): UIMessage[] {
	const out: UIMessage[] = [];
	for (const m of stripTrailingAssistantToolTurns(messages)) {
		if (m.id === initMessage.id) continue;
		const role = m.role as string;
		if (role === 'data') {
			if ((m as unknown as FunctionMessage).name === 'capture_lead_intent') out.push(m);
			continue;
		}
		if (role !== 'user' && role !== 'assistant') continue;
		const parts = m.parts.filter((p) => SAVED_PART_TYPES.has(p.type));
		if (!parts.some((p) => p.type === 'text' && (p as { text: string }).text.trim())) continue;
		out.push({ ...m, parts });
	}
	return out.slice(-MAX_SAVED_MESSAGES);
}

function clearSavedChat() {
	try {
		localStorage.removeItem(CHAT_KEY);
	} catch {
		// Storage can be blocked (private mode) — persistence is best-effort
	}
}

function saveChat() {
	if (typeof window === 'undefined' || !chatInstance) return;
	try {
		const messages = sanitizeForStorage(chatInstance.messages);
		if (!messages.some((m) => m.role === 'user')) return;
		localStorage.setItem(CHAT_KEY, JSON.stringify({ savedAt: Date.now(), messages }));
		localStorage.setItem(SESSION_KEY, JSON.stringify({ id: SESSION_ID, at: Date.now() }));
	} catch {
		// Quota or blocked storage — the chat still works, it just won't survive a restart
	}
}

function loadSavedChat(): UIMessage[] | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = localStorage.getItem(CHAT_KEY);
		if (!raw) return null;
		const { savedAt, messages } = JSON.parse(raw) as { savedAt?: number; messages?: UIMessage[] };
		if (
			typeof savedAt !== 'number' ||
			Date.now() - savedAt > STORAGE_TTL_MS ||
			!Array.isArray(messages) ||
			!messages.some((m) => m.role === 'user')
		) {
			clearSavedChat();
			return null;
		}
		return messages;
	} catch {
		clearSavedChat();
		return null;
	}
}

// Typing "clear" works like a terminal: instant, no model call.
const RESET_COMMAND = /^\/?(clear|reset|start over|new chat)[.!]?$/i;
// `/simulate Airbnb` restarts the chat as if the visitor were on that company's network;
// `/simulate off` goes back to normal. Not advertised anywhere.
const SIMULATE_COMMAND = /^\/simulate(?:\s+(.+))?$/i;

/** Handles `/simulate`; returns true when the text was that command. */
function runSimulateCommand(text: string): boolean {
	const match = SIMULATE_COMMAND.exec(text.trim());
	if (!match) return false;
	const name = match[1]?.trim();
	const off = !name || /^(off|none|reset)$/i.test(name);
	setSimulatedOrg(off ? null : name);
	// Resetting re-runs the on-open trigger in ChatBox; mark it done so only this call asks.
	try {
		sessionStorage.setItem(ROLE_OPENER_KEY, '1');
	} catch {
		roleOpenerAsked = true;
	}
	resetChat('command');
	if (!off) void triggerRoleOpener(name);
	return true;
}

/** Wipes the conversation (and its saved copy) back to the greeting. */
export function resetChat(trigger: 'command' | 'tool') {
	if (!chatInstance) return;
	void chatInstance.stop();
	cancelContextFetches();
	suggestions.set([]);
	scrollSuggestions.set([]);
	hoverSuggestions.set([]);
	clearSavedChat();
	restoredMessageIds.clear();
	chatInstance.messages = [{ ...initMessage, parts: [{ type: 'text', text: greetingResponse }] }];
	captureEvent('chat_reset', SESSION_ID, { session_id: SESSION_ID, trigger });
}

export const botEngaged = writable(false);
export const minimized = writable(true);

// Helper to extract text from a UIMessage's parts
export function getMessageText(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

/** Extracts the site pages (source-url UI parts) that grounded an assistant reply. */
export function getMessageSources(message: UIMessage): { url: string; title?: string }[] {
	const seen = new Set<string>();
	const sources: { url: string; title?: string }[] = [];
	for (const p of message.parts) {
		if (p.type === 'source-url') {
			const part = p as { url: string; title?: string };
			if (seen.has(part.url)) continue;
			seen.add(part.url);
			sources.push({ url: part.url, title: part.title });
		}
	}
	return sources;
}

/** A tappable answer under a bot question: chip text, and what is sent when it's tapped. */
export type ChatOption = { label: string; reply: string };

/** True when the reply text already asks the question (reworded copies count: the model writes both). */
function alreadyAsked(text: string, question: string): boolean {
	const norm = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	return norm(text).includes(norm(question)) || /\?["')\]]*\s*$/.test(text.trim());
}

function cleanOptions(raw: unknown): ChatOption[] {
	if (!Array.isArray(raw)) return [];
	const out: ChatOption[] = [];
	for (const o of raw as { label?: unknown; reply?: unknown }[]) {
		const label = typeof o?.label === 'string' ? o.label.trim().slice(0, 80) : '';
		if (!label) continue;
		const reply =
			typeof o.reply === 'string' && o.reply.trim() ? o.reply.trim().slice(0, 300) : label;
		if (out.some((x) => x.label === label)) continue;
		out.push({ label, reply });
		if (out.length === 5) break;
	}
	return out;
}

/** Tappable answers attached to a reply (`data-options` part, from `ask_visitor` or the role opener). */
export function getMessageOptions(message: UIMessage): ChatOption[] {
	for (const p of message.parts) {
		if (p.type === 'data-options') {
			return cleanOptions((p as { data?: { options?: unknown } }).data?.options);
		}
	}
	return [];
}

/** Closest site pages the server attached to a reply that came up empty (`data-related` part). */
export function getMessageRelated(message: UIMessage): { path: string; title: string }[] {
	for (const p of message.parts) {
		if (p.type === 'data-related') {
			const pages = (p as { data?: { pages?: { path: string; title: string }[] } }).data?.pages;
			if (Array.isArray(pages)) return pages;
		}
	}
	return [];
}

/** True once the in-flight assistant reply has any visible text (hides loading placeholder while still streaming). */
export function streamingAssistantHasText(messages: UIMessage[]): boolean {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			lastUserIdx = i;
			break;
		}
	}
	for (let i = lastUserIdx + 1; i < messages.length; i++) {
		const m = messages[i];
		if (m.role === 'assistant' && getMessageText(m).trim()) return true;
	}
	return false;
}

/**
 * Reads the server's live pipeline-stage label off the in-flight assistant message
 * (a `data-status` part the chat endpoint pushes as it works through retrieval/generation).
 * Used to show real progress in the loading indicator instead of canned phrases.
 */
export function getStreamingStatus(messages: UIMessage[]): string | undefined {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			lastUserIdx = i;
			break;
		}
	}
	for (let i = lastUserIdx + 1; i < messages.length; i++) {
		const m = messages[i];
		if (m.role !== 'assistant') continue;
		for (const p of m.parts) {
			if (p.type === 'data-status') {
				const label = (p as { data?: { label?: string } }).data?.label;
				if (label) return label;
			}
		}
	}
	return undefined;
}

export const chat = () => {
	const restored = loadSavedChat();
	if (restored) {
		restored.forEach((m) => restoredMessageIds.add(m.id));
		botEngaged.set(true);
	}

	const instance = new Chat({
		id: 'uniquechatid',
		messages: restored ?? [initMessage],
		transport: new DefaultChatTransport({
			api: '/api/chat',
			// A function, so each turn carries the visitor's latest pages and dwell times
			body: () => ({ sessionId: SESSION_ID, visitor: getVisitorContext() })
		}),
		// find_open_roles sends `data-company` (transient) when the visitor says where they work;
		// keep it so later turns and the opener know it (the "stated" company layer).
		onData: (part) => {
			if (part.type !== 'data-company') return;
			const name = (part.data as { name?: unknown } | undefined)?.name;
			if (typeof name === 'string' && name.trim()) setStatedCompany(name.trim());
		},
		onToolCall: async ({ toolCall }) => {
			// In v6, tool call has toolName + input (not args)
			const tc = toolCall as unknown as {
				toolCallId: string;
				toolName: string;
				input: Record<string, unknown>;
			};
			handleToolCall({ toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.input });
		}
	});

	chatInstance = instance;

	if (!restored) {
		setTimeout(() => {
			// A reply may already be streaming if the visitor was quick
			if (instance.messages.length > 1 || instance.messages.some(isRoleOpener)) return;
			instance.messages = [{ ...initMessage, parts: [{ type: 'text', text: greetingResponse }] }];
		}, 2000);
	}

	// Save once a turn settles; tool calls rewrite messages outside streaming and save themselves.
	$effect.root(() => {
		$effect(() => {
			if (instance.status === 'ready' || instance.status === 'error') saveChat();
		});
	});

	// Bridge reactive Chat properties to Svelte stores for backward compat.
	// Deep-read text parts: streaming applies deltas in place on the same message object, so a
	// shallow `() => instance.messages` does not invalidate `toStore` when tokens arrive.
	const messages = toStore(() => {
		const msgs = instance.messages;
		for (const m of msgs) {
			for (const p of m.parts) {
				if (p.type === 'text') {
					void p.text;
				}
			}
		}
		return msgs;
	});
	const isLoading = toStore(
		() => instance.status === 'streaming' || instance.status === 'submitted'
	);
	const input = writable('');

	function handleSubmit(event?: { preventDefault?: () => void }) {
		event?.preventDefault?.();
		// The send button is disabled mid-reply, but Enter (or a phone keyboard's Go key) still
		// submits the form. Sending then starts a second stream alongside the first, and the
		// Chat class isn't built for that: the in-flight reply was lost when a visitor asked
		// "Hello?" during a slow turn. Leave the text in the box to send once the reply lands.
		if (instance.status === 'streaming' || instance.status === 'submitted') return;
		let value = '';
		input.update((v) => {
			value = v;
			return '';
		});
		if (runSimulateCommand(value)) {
			// handled
		} else if (RESET_COMMAND.test(value.trim())) {
			resetChat('command');
		} else if (value.trim()) {
			instance.sendMessage({ text: value.trim() });
		}
	}

	async function append(message: { role: string; content: string }) {
		if (message.role === 'user') {
			if (runSimulateCommand(message.content)) return;
			if (RESET_COMMAND.test(message.content.trim())) resetChat('command');
			else await instance.sendMessage({ text: message.content });
		}
	}

	function setMessages(msgs: UIMessage[]) {
		instance.messages = msgs;
	}

	return { messages, isLoading, handleSubmit, input, append, setMessages };
};

/** True for UI tool parts in AI SDK v6 (`tool-*`, `dynamic-tool`) and legacy `tool-invocation`. */
function partLooksLikeToolInvocation(p: { type: string }): boolean {
	return (
		p.type === 'tool-invocation' ||
		p.type === 'dynamic-tool' ||
		(typeof p.type === 'string' && p.type.startsWith('tool-'))
	);
}

/**
 * Remove trailing assistant rows that still contain tool-call UI parts.
 * Client-side tools are handled by replacing the turn with synthetic messages (no addToolOutput).
 * Leaving SDK tool rows in history sends dangling tool_calls to the model without tool results,
 * which often yields empty assistant text on the next turn (spinner stops, no bubble).
 */
function stripTrailingAssistantToolTurns(messages: UIMessage[]): UIMessage[] {
	const out = [...messages];
	while (out.length > 0) {
		const last = out[out.length - 1];
		if (last.role !== 'assistant') break;
		const hasToolPart = last.parts.some((p) => partLooksLikeToolInvocation(p));
		if (!hasToolPart) break;
		out.pop();
	}
	return out;
}

function handleToolCall(toolCall: {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
}) {
	if (!chatInstance) {
		console.error('Chat instance not initialized.');
		return;
	}

	const baseMessages = stripTrailingAssistantToolTurns(chatInstance.messages);
	// Any answer the model wrote before calling the tool lives in the turn that was just
	// stripped; keep it so routing or lead capture adds to the reply instead of replacing it.
	const streamedText = chatInstance.messages
		.slice(baseMessages.length)
		.filter((m) => m.role === 'assistant')
		.map(getMessageText)
		.join('\n\n')
		.trim();

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
			parts: [{ type: 'text', text: streamedText || args.message || `Taking you to ${args.page}.` }]
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
	} else if (toolCall.toolName === 'ask_visitor') {
		const args = toolCall.args as { question?: string; options?: ChatOption[] };
		const options = cleanOptions(args.options);
		const question = args.question?.trim();
		// Keep what the model already wrote; add the question only when it says something new.
		const text =
			streamedText && question && !alreadyAsked(streamedText, question)
				? `${streamedText}\n\n${question}`
				: streamedText || question || "Could you tell me a bit more about what you're looking for?";
		chatInstance.messages = [
			...baseMessages,
			{
				id: generateId(),
				role: 'assistant',
				parts: [
					{ type: 'text', text },
					...(options.length ? [{ type: 'data-options', data: { options } }] : [])
				] as UIMessage['parts']
			}
		];
	} else if (toolCall.toolName === 'capture_lead_intent') {
		const args = toolCall.args as { intent_type: string; message: string };
		const warmMessage =
			streamedText || args.message || "Sounds like you're interested in working with Hunter.";
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
	saveChat();
}
