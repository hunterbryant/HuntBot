<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import ChatSuggestions from './ChatSuggestions.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { derived, get } from 'svelte/store';
	import { afterNavigate } from '$app/navigation';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import arrowdown from '$lib/assets/arrow-down.svg';
	import { navEngaged, mobile } from '$lib/nav/navstore';
	import { page } from '$app/stores';
	import ActionMessage from './ActionMessage.svelte';
	import {
		chat,
		botEngaged,
		minimized,
		suggestions,
		scrollSuggestions,
		hoverSuggestions,
		loadingContextSuggestions,
		cancelContextFetches,
		fetchSuggestions,
		triggerProactiveOpener,
		getMessageText,
		streamingAssistantHasText,
		SESSION_ID
	} from './MessageStore.svelte';
	import { createPageSuggestionObservers } from './pageSuggestionObservers';
	import type { FunctionMessage } from '$lib/types';
	import { captureEvent } from '$lib/analytics';
	import LoadingStream from './LoadingStream.svelte';

	const { messages, isLoading, handleSubmit, input, append } = chat();

	const pageObservers = createPageSuggestionObservers(() => get(mobile));

	const animatedMessageIds = new Set<string>();

	function shouldAnimate(id: string): boolean {
		if (animatedMessageIds.has(id)) return false;
		animatedMessageIds.add(id);
		return true;
	}

	let scrollElement: HTMLDivElement;
	let isScrolling = false;
	let scrolledToBottom = false;

	export let greeting: string = "Hi, I'm HuntBot";

	let messageScrollTimer: ReturnType<typeof setTimeout> | null = null;
	let suggestionChipScrollTimer: ReturnType<typeof setTimeout> | null = null;
	let postResponseSuggestTimer: ReturnType<typeof setTimeout> | null = null;

	// Check if scrolled to the bottom
	function checkScrolledDown() {
		scrolledToBottom =
			scrollElement.scrollTop >= scrollElement.scrollHeight - scrollElement.offsetHeight - 40;
	}

	// Check if scrolling is active
	$: if (scrollElement && $messages.length > 2) {
		isScrolling = scrollElement.scrollHeight > scrollElement.clientHeight;
	}

	//Scroll to the bottom
	const scrollToBottom = async () => {
		if (scrollElement) {
			// Check to see if the scroll is active
			if (scrollElement.scrollHeight > scrollElement.clientHeight) {
				scrollElement.scroll({ top: scrollElement.scrollHeight + 10, behavior: 'smooth' });
			}
		}
	};

	const unsubMessages = messages.subscribe(() => {
		scrollToBottom();
		if (messageScrollTimer) clearTimeout(messageScrollTimer);
		messageScrollTimer = setTimeout(() => {
			scrollToBottom();
			messageScrollTimer = null;
		}, 400);
	});

	// Scroll down when new suggestion chips appear so they don't push content out of view
	$: if (!$minimized && ($suggestions.length > 0 || $hoverSuggestions.length > 0)) {
		if (suggestionChipScrollTimer) clearTimeout(suggestionChipScrollTimer);
		suggestionChipScrollTimer = setTimeout(() => {
			scrollToBottom();
			suggestionChipScrollTimer = null;
		}, 200);
	}

	// Gate: hold back all pre-conversation suggestions until the greeting has been read
	let readyForSuggestions = false;
	let greetingReadTimer: ReturnType<typeof setTimeout> | null = null;

	$: {
		const greetingLoaded =
			$botEngaged &&
			!$minimized &&
			$messages.some((m) => m.role === 'assistant' && getMessageText(m).trim().length > 1);
		const hasUser = $messages.some((m) => m.role === 'user');

		if (hasUser) {
			readyForSuggestions = true;
		} else if (greetingLoaded && !readyForSuggestions) {
			if (!greetingReadTimer) {
				greetingReadTimer = setTimeout(() => {
					greetingReadTimer = null;
					readyForSuggestions = true;
					fetchSuggestions($messages, $page.url.pathname);
				}, 3000);
			}
		} else if (!greetingLoaded) {
			if (greetingReadTimer) {
				clearTimeout(greetingReadTimer);
				greetingReadTimer = null;
			}
			readyForSuggestions = false;
		}
	}

	// Active suggestions to display.
	// Pre-conversation: hover > scroll > default.
	// Once a conversation is underway, post-response suggestions ($sugg) take
	// priority so they aren't displaced by stale hover/scroll context fetches.
	const activeSuggestions = derived(
		[messages, hoverSuggestions, scrollSuggestions, suggestions],
		([$msgs, $hover, $scroll, $sugg]) => {
			const hasUser = $msgs.some((m) => m.role === 'user');
			if (!readyForSuggestions && !hasUser) return [];
			if (hasUser) {
				if ($sugg.length > 0) return $sugg;
				if ($hover.length > 0) return $hover;
				return [];
			}
			if ($hover.length > 0) return $hover;
			if ($scroll.length > 0) return $scroll;
			return $sugg;
		}
	);

	$: if (!$navEngaged) {
		minimized.set(true);
	}

	// Track loading transitions to fetch suggestions after each bot response,
	// but only once a real conversation is underway (user has sent at least one message)
	let prevLoading = false;
	$: {
		if (prevLoading && !$isLoading) {
			const hasUserMessages = $messages.some((m) => m.role === 'user');
			if (hasUserMessages) {
				if (postResponseSuggestTimer) clearTimeout(postResponseSuggestTimer);
				postResponseSuggestTimer = setTimeout(() => {
					postResponseSuggestTimer = null;
					fetchSuggestions($messages, $page.url.pathname);
				}, 2000);
			}
		}
		prevLoading = $isLoading ?? false;
	}

	// Clear suggestions when user starts typing
	$: if ($input && $input.trim() !== '') {
		suggestions.set([]);
	}

	// Proactive page-aware opener: fire when user navigates to a project/case study
	// and hasn't started a conversation yet
	let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
	let lastProactivePage = '';

	$: {
		const path = $page.url.pathname;
		const isProjectPage = /^\/(case-studies|projects)\/.+/.test(path);
		const hasUserMessages = $messages.some((m) => m.role === 'user');

		if (isProjectPage && path !== lastProactivePage && !hasUserMessages && !$minimized) {
			lastProactivePage = path;
			if (proactiveTimer) clearTimeout(proactiveTimer);
			proactiveTimer = setTimeout(() => {
				proactiveTimer = null;
				// Re-check at fire time — the user may have sent a message during the delay
				if ($messages.some((m) => m.role === 'user')) return;
				triggerProactiveOpener($messages, path);
			}, 2500);
		} else if (!isProjectPage && lastProactivePage) {
			// Reset when navigating away so it can fire again on the next project page
			lastProactivePage = '';
			if (proactiveTimer) clearTimeout(proactiveTimer);
			proactiveTimer = null;
		}
	}

	onMount(() => {
		pageObservers.mount($page.url.pathname);
	});

	onDestroy(() => {
		unsubMessages();
		if (messageScrollTimer) clearTimeout(messageScrollTimer);
		if (suggestionChipScrollTimer) clearTimeout(suggestionChipScrollTimer);
		if (postResponseSuggestTimer) clearTimeout(postResponseSuggestTimer);
		if (greetingReadTimer) clearTimeout(greetingReadTimer);
		if (proactiveTimer) clearTimeout(proactiveTimer);
		pageObservers.reset();
	});

	afterNavigate(({ to }) => {
		const path = to?.url.pathname ?? $page.url.pathname;
		pageObservers.rescheduleAfterNavigate(path);
	});

	async function selectSuggestion(suggestion: string) {
		cancelContextFetches();
		captureEvent('suggestion_clicked', SESSION_ID, {
			suggestion_text: suggestion,
			current_page: $page.url.pathname,
			session_id: SESSION_ID
		});
		suggestions.set([]);
		scrollSuggestions.set([]);
		hoverSuggestions.set([]);
		minimized.set(false);
		// Server derives currentPage from the Referer header automatically
		await append({ role: 'user', content: suggestion });
	}

	function retryLastResponse() {
		captureEvent('not_helpful', SESSION_ID, {
			session_id: SESSION_ID,
			current_page: $page.url.pathname
		});
		append({
			role: 'user',
			content: "That response wasn't quite right — can you give a more specific or direct answer?"
		});
	}

	// When context is being fetched and the chat hasn't opened yet, transition to the
	// minimized placeholder state so the user sees context is being generated.
	$: if ($loadingContextSuggestions && !$botEngaged) {
		botEngaged.set(true);
	}
</script>

<div
	class="flex-col-rev z-50 mb-0 flex max-h-[calc(100dvh-4.5rem)] w-full flex-col flex-nowrap overflow-hidden rounded-t-lg border-t border-stone-200 bg-white sm:left-auto sm:mb-4 sm:max-h-[calc(100dvh-2rem)] sm:rounded-lg sm:border dark:border-stone-800 dark:bg-black"
>
	<!-- This initial "message" acts as the header and original kickoff button -->
	{#if !$botEngaged || !$minimized}
		<GreetingMessage bind:greeting />
	{/if}

	{#if !$minimized}
		<!-- This is the scrollable zone -->
		<div
			class="relative overflow-scroll"
			bind:this={scrollElement}
			on:scroll={checkScrolledDown}
			transition:slide|global={{ duration: 300, easing: cubicOut }}
			on:introend={() => {
				scrollToBottom();
				setTimeout(() => {
					scrollToBottom();
				}, 400);
			}}
		>
			<!-- This is the scroll to bottom button -->
			{#if isScrolling && !scrolledToBottom}
				<div
					transition:fade|global
					class="sticky top-[calc(100%-6rem)] mx-0 -mt-20 block h-24 w-full bg-gradient-to-b from-transparent to-white dark:to-black"
				>
					<button
						on:click={() => {
							scrollToBottom();
						}}
						class="dark:hover:ng-stone-700 absolute bottom-2 left-1/2 mx-auto block h-8 w-8 -translate-x-1/2 rounded border border-stone-300 bg-stone-200 transition hover:bg-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700"
					>
						<img src={arrowdown} alt="Down arrow icon" class="m-auto flex-none dark:invert" />
					</button>
				</div>
			{/if}
			<!-- Render the chat messages -->
			<div
				class="first:pt-4 {$activeSuggestions.length > 0 && !$isLoading && $input.trim() === ''
					? ''
					: 'last:pb-6'}"
			>
				{#each $messages as message, i}
					<div
						in:slide|global={{ duration: message.role === 'assistant' ? 0 : 400 }}
						on:introend={() => {
							scrollToBottom();
							setTimeout(() => {
								scrollToBottom();
							}, 400);
						}}
					>
						{#if message.role === 'user'}
							<UserMessage value={getMessageText(message)} />
						{:else if message.role === 'assistant' && getMessageText(message).trim()}
							<BotMessage
								value={getMessageText(message)}
								isLast={i === $messages.length - 1 && !$isLoading}
								onRetry={retryLastResponse}
								animate={shouldAnimate(message.id)}
							/>
						{:else if (message.role as string) === 'data'}
							<ActionMessage value={message as unknown as FunctionMessage} />
						{/if}
					</div>
				{/each}
				{#if $isLoading && !streamingAssistantHasText($messages)}
					<div
						in:slide|global={{ duration: 400 }}
						out:fade|global={{ duration: 200 }}
						on:introend={() => {
							scrollToBottom();
							setTimeout(() => {
								scrollToBottom();
							}, 400);
						}}
					>
						<LoadingStream />
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if $botEngaged && !$minimized && !$isLoading && $input.trim() === ''}
		<div out:slide|global={{ duration: 200, easing: cubicOut }}>
			<ChatSuggestions suggestions={$activeSuggestions} onSelect={selectSuggestion} />
		</div>
	{/if}
	{#if $botEngaged}
		<TextInput
			{isLoading}
			{handleSubmit}
			{input}
			currentPage={$page.url.pathname}
			onPlaceholderSelect={selectSuggestion}
		/>
	{/if}
</div>
