<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import ChatSuggestions from './ChatSuggestions.svelte';
	import { onDestroy } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import arrowdown from '$lib/assets/arrow-down.svg';
	import { navEngaged } from '$lib/nav/navstore';
	import { page } from '$app/stores';
	import ActionMessage from './ActionMessage.svelte';
	import {
		chat,
		minimized,
		suggestions,
		clearSuggestions,
		clearPageSuggestions,
		cancelContextFetches,
		fetchSuggestions,
		fetchContextSuggestions,
		triggerProactiveOpener,
		openChat,
		isHiddenMessage,
		getMessageText,
		getMessageSources,
		getMessageRelated,
		streamingAssistantHasText,
		getStreamingStatus,
		restoredMessageIds,
		SESSION_ID
	} from './MessageStore.svelte';
	import type { FunctionMessage } from '$lib/types';
	import { captureEvent } from '$lib/analytics';
	import LoadingStream from './LoadingStream.svelte';

	const { messages, isLoading, handleSubmit, input, append, sendHidden } = chat();

	// Restored replies were already read, so they skip the reveal animation
	const animatedMessageIds = new Set<string>(restoredMessageIds);

	function shouldAnimate(id: string): boolean {
		if (animatedMessageIds.has(id)) return false;
		animatedMessageIds.add(id);
		return true;
	}

	let scrollElement: HTMLDivElement;
	let isScrolling = false;
	let scrolledToBottom = false;

	export let greeting: string = "Hi, I'm HuntBot";

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

	messages.subscribe(() => {
		scrollToBottom();
		setTimeout(() => {
			scrollToBottom();
		}, 400);
	});

	// --- Suggestion chips ---
	// One row above the input, in the open chat only (closed, it's just the input). The newest set
	// wins (see `suggestions` in MessageStore); sets fetched while closed are ready when it opens.
	$: visibleChips =
		!$minimized && !$isLoading && $input.trim() === '' ? $suggestions.items : [];

	// Scroll down when new chips appear so they don't push content out of view
	$: if (visibleChips.length > 0) {
		setTimeout(() => scrollToBottom(), 200);
	}

	// Impressions count chips that were on screen, not sets that were fetched: fetched sets used to
	// be logged even when they were never displayed.
	let lastShownKey = '';
	$: {
		const key = visibleChips.join('|');
		if (key && key !== lastShownKey) {
			lastShownKey = key;
			captureEvent('suggestions_shown', SESSION_ID, {
				suggestion_type: $suggestions.type,
				suggestions: visibleChips,
				current_page: $page.url.pathname,
				session_id: SESSION_ID
			});
		}
	}

	$: if (!$navEngaged) {
		minimized.set(true);
	}

	// "Not helpful" belongs under an answer, not under the greeting or a proactive opener
	$: hasAsked = $messages.some((m) => m.role === 'user');

	// After each reply: fetch follow-up chips (once a real conversation is underway), and hand the
	// finished reply to screen readers in one piece. The streamed text itself arrives a few
	// characters at a time, which a live region would read out as fragments.
	let announcement = '';
	let prevLoading = false;
	$: {
		if (prevLoading && !$isLoading) {
			const lastReply = [...$messages]
				.reverse()
				.find((m) => m.role === 'assistant' && getMessageText(m).trim());
			announcement = lastReply ? getMessageText(lastReply) : '';
			if ($messages.some((m) => m.role === 'user')) {
				setTimeout(() => fetchSuggestions($messages, $page.url.pathname), 2000);
			}
		}
		prevLoading = $isLoading ?? false;
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
				// Re-check at fire time — the user may have sent a message during the delay
				if ($messages.some((m) => m.role === 'user')) return;
				triggerProactiveOpener($messages, path);
			}, 2500);
		} else if (!isProjectPage && lastProactivePage) {
			// Reset when navigating away so it can fire again on the next project page
			lastProactivePage = '';
			if (proactiveTimer) clearTimeout(proactiveTimer);
		}
	}

	// --- Section-aware chips via IntersectionObserver + scroll-depth fallback ---
	// Primary: observes h1–h4 headings and first heading within Prismic slice containers.
	// Fallback: on heading-sparse pages (e.g. one big TextBlock), fires at scroll-depth
	// milestones (25%, 50%, 75%) so long-form content still gets fresh chips.
	// Both share one budget per page (3s dwell before firing). The page-level chips fetched on
	// arrival don't count against it.

	const DWELL_MS = 3000;
	const MAX_SECTION_FETCHES = 2;
	const MIN_OBSERVABLE = 3;
	const DEPTH_MILESTONES = [25, 50, 75];

	// One timer per heading: with a single shared timer, any heading scrolling out of view
	// cancelled the one the visitor was actually reading.
	const dwellTimers = new Map<Element, ReturnType<typeof setTimeout>>();
	let sectionObserver: IntersectionObserver | null = null;
	let fetchedHeadings = new Set<string>();
	let sectionFetches = 0;

	let scrollFallbackTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollFallbackHandler: (() => void) | null = null;
	let milestonesFired = new Set<number>();

	// Headings on screen at arrival are already covered by the page's own chips (and replacing
	// those a few seconds after landing just churned the row), so observing starts once the
	// visitor has scrolled a real distance.
	const ARM_SCROLL_PX = 200;
	let armHandler: (() => void) | null = null;

	function disarmHeadingObserver() {
		if (armHandler) window.removeEventListener('scroll', armHandler);
		armHandler = null;
	}

	function getScrollDepth(): number {
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const docHeight = document.documentElement.scrollHeight - viewportHeight;
		return docHeight > 0 ? Math.round((window.scrollY / docHeight) * 100) : 0;
	}

	function clearDwellTimers() {
		dwellTimers.forEach((t) => clearTimeout(t));
		dwellTimers.clear();
	}

	function getObservableElements(): Element[] {
		const seen = new Set<Element>();
		const results: Element[] = [];

		document.querySelectorAll('h1, h2, h3, h4').forEach((el) => {
			seen.add(el);
			results.push(el);
		});

		document.querySelectorAll('[data-slice-type]').forEach((slice) => {
			const heading = slice.querySelector('h1, h2, h3, h4, h5');
			if (heading && !seen.has(heading)) {
				seen.add(heading);
				results.push(heading);
			}
		});

		return results;
	}

	function setupScrollDepthFallback(pathname: string) {
		if (scrollFallbackHandler) window.removeEventListener('scroll', scrollFallbackHandler);

		scrollFallbackHandler = () => {
			if (scrollFallbackTimer) clearTimeout(scrollFallbackTimer);
			scrollFallbackTimer = setTimeout(() => {
				const depth = getScrollDepth();
				for (const milestone of DEPTH_MILESTONES) {
					if (depth >= milestone && !milestonesFired.has(milestone)) {
						if (sectionFetches >= MAX_SECTION_FETCHES) return;
						milestonesFired.add(milestone);
						sectionFetches++;
						fetchContextSuggestions(
							{ kind: 'scroll', scrollDepth: depth, sectionHeading: null },
							pathname,
							$messages
						);
						break;
					}
				}
			}, DWELL_MS);
		};

		window.addEventListener('scroll', scrollFallbackHandler, { passive: true });
	}

	function setupHeadingObserver(pathname: string) {
		if (sectionObserver) sectionObserver.disconnect();

		const observables = getObservableElements();

		// Heading-sparse page — use scroll-depth milestones instead
		if (observables.length < MIN_OBSERVABLE) {
			setupScrollDepthFallback(pathname);
		}

		sectionObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const heading = entry.target.textContent?.trim() ?? null;
					if (!heading) continue;

					if (entry.isIntersecting && !fetchedHeadings.has(heading)) {
						if (dwellTimers.has(entry.target)) continue;
						dwellTimers.set(
							entry.target,
							setTimeout(() => {
								dwellTimers.delete(entry.target);
								if (sectionFetches >= MAX_SECTION_FETCHES || fetchedHeadings.has(heading)) return;
								fetchedHeadings.add(heading);
								sectionFetches++;
								// Other headings in view would fire right after and replace these chips
								clearDwellTimers();
								fetchContextSuggestions(
									{ kind: 'scroll', scrollDepth: getScrollDepth(), sectionHeading: heading },
									pathname,
									$messages
								);
							}, DWELL_MS)
						);
					} else if (!entry.isIntersecting) {
						const timer = dwellTimers.get(entry.target);
						if (timer) clearTimeout(timer);
						dwellTimers.delete(entry.target);
					}
				}
			},
			{ threshold: 0.5 }
		);

		disarmHeadingObserver();
		armHandler = () => {
			if (window.scrollY < ARM_SCROLL_PX) return;
			disarmHeadingObserver();
			observables.forEach((el) => sectionObserver?.observe(el));
		};
		window.addEventListener('scroll', armHandler, { passive: true });
	}

	function resetScrollState() {
		if (sectionObserver) sectionObserver.disconnect();
		disarmHeadingObserver();
		clearDwellTimers();
		if (scrollFallbackTimer) clearTimeout(scrollFallbackTimer);
		scrollFallbackTimer = null;
		if (scrollFallbackHandler) {
			window.removeEventListener('scroll', scrollFallbackHandler);
			scrollFallbackHandler = null;
		}
		fetchedHeadings.clear();
		milestonesFired.clear();
		sectionFetches = 0;
		teardownHoverObserver();
	}

	// --- Hover-aware chips (mouse and trackpad only) ---
	// When the visitor dwells on a content block for 2s, fetch chips specific to that passage.
	// They stay until something newer replaces them (they used to vanish after 15s).

	const HOVER_DWELL_MS = 2000;
	const HOVER_COOLDOWN_MS = 3000;
	const MAX_HOVER_FETCHES = 3;

	let hoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
	let hoverFetchCount = 0;
	let lastHoverFetchTime = 0;
	let hoveredFingerprints = new Set<string>();
	let hoverCleanups: (() => void)[] = [];

	function flashContextOverlay(el: Element) {
		const htmlEl = el as HTMLElement;

		const isDark =
			document.documentElement.classList.contains('dark') ||
			window.matchMedia('(prefers-color-scheme: dark)').matches;
		const highlight = isDark ? '#292524' : '#57534e';
		const textColor = getComputedStyle(htmlEl).color;

		const styledProps = [
			'background-image',
			'background-size',
			'background-position',
			'background-clip',
			'-webkit-background-clip',
			'-webkit-text-fill-color',
			'color',
			'transition'
		];
		const saved = new Map<string, string>();
		styledProps.forEach((p) => saved.set(p, htmlEl.style.getPropertyValue(p)));

		htmlEl.style.setProperty(
			'background-image',
			`linear-gradient(90deg, ${textColor} 0%, ${textColor} 35%, ${highlight} 50%, ${textColor} 65%, ${textColor} 100%)`
		);
		htmlEl.style.setProperty('background-size', '300% 100%');
		htmlEl.style.setProperty('background-position', '100% 0');
		htmlEl.style.setProperty('-webkit-background-clip', 'text');
		htmlEl.style.setProperty('background-clip', 'text');
		htmlEl.style.setProperty('-webkit-text-fill-color', 'transparent');
		htmlEl.style.setProperty('color', 'transparent');

		void htmlEl.offsetHeight;

		htmlEl.style.setProperty('transition', 'background-position 1400ms ease-in-out');
		htmlEl.style.setProperty('background-position', '0% 0');

		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			htmlEl.removeEventListener('transitionend', cleanup);
			styledProps.forEach((p) => {
				const orig = saved.get(p)!;
				if (orig) htmlEl.style.setProperty(p, orig);
				else htmlEl.style.removeProperty(p);
			});
		};

		htmlEl.addEventListener('transitionend', cleanup, { once: true });
		setTimeout(cleanup, 1600);
	}

	function extractHoverContext(el: Element): string {
		const own = el.textContent?.trim() ?? '';
		const prev = el.previousElementSibling?.textContent?.trim() ?? '';
		const next = el.nextElementSibling?.textContent?.trim() ?? '';
		const parts = [prev, own, next].filter(Boolean);
		return parts.join(' ').slice(0, 500);
	}

	function fingerprint(text: string): string {
		return text.slice(0, 80);
	}

	function setupHoverObserver(pathname: string) {
		teardownHoverObserver();

		// Checked directly rather than via the `mobile` store, which may not be set yet on first load
		if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		const targets = document.querySelectorAll(
			'[data-slice-type] p, [data-slice-type] blockquote, [data-slice-type] figcaption'
		);

		targets.forEach((el) => {
			const onEnter = () => {
				if (hoverDwellTimer) clearTimeout(hoverDwellTimer);

				hoverDwellTimer = setTimeout(() => {
					if (hoverFetchCount >= MAX_HOVER_FETCHES) return;
					if (Date.now() - lastHoverFetchTime < HOVER_COOLDOWN_MS) return;
					const context = extractHoverContext(el);
					const fp = fingerprint(context);
					if (hoveredFingerprints.has(fp)) return;
					hoveredFingerprints.add(fp);
					hoverFetchCount++;
					lastHoverFetchTime = Date.now();
					// The shimmer says "chips about this are coming", so only when the row is on screen
					if (!reduceMotion && !$minimized) flashContextOverlay(el);
					fetchContextSuggestions({ kind: 'hover', hoveredContent: context }, pathname, $messages);
				}, HOVER_DWELL_MS);
			};

			const onLeave = () => {
				if (hoverDwellTimer) {
					clearTimeout(hoverDwellTimer);
					hoverDwellTimer = null;
				}
			};

			el.addEventListener('mouseenter', onEnter);
			el.addEventListener('mouseleave', onLeave);
			hoverCleanups.push(() => {
				el.removeEventListener('mouseenter', onEnter);
				el.removeEventListener('mouseleave', onLeave);
			});
		});
	}

	function teardownHoverObserver() {
		hoverCleanups.forEach((fn) => fn());
		hoverCleanups = [];
		if (hoverDwellTimer) clearTimeout(hoverDwellTimer);
		hoverDwellTimer = null;
		hoverFetchCount = 0;
		hoveredFingerprints.clear();
	}

	onDestroy(() => {
		resetScrollState();
	});

	// Runs when the chat mounts and on every navigation. Chips for the new page are fetched right
	// away, so they're ready when the chat is opened (there's no waiting on a greeting timer).
	afterNavigate(({ to }) => {
		const path = to?.url.pathname ?? $page.url.pathname;
		resetScrollState();
		clearPageSuggestions();
		fetchContextSuggestions({ kind: 'page' }, path, $messages);
		setTimeout(() => {
			setupHeadingObserver(path);
			setupHoverObserver(path);
		}, 300);
	});

	async function selectSuggestion(suggestion: string) {
		cancelContextFetches();
		captureEvent('suggestion_clicked', SESSION_ID, {
			suggestion_text: suggestion,
			suggestion_type: $suggestions.type,
			current_page: $page.url.pathname,
			session_id: SESSION_ID
		});
		clearSuggestions();
		openChat('chip');
		// Server derives currentPage from the Referer header automatically
		await append({ role: 'user', content: suggestion });
	}

	function retryLastResponse() {
		// Include the exchange being flagged so the event can be read on its own.
		const lastBot = [...$messages]
			.reverse()
			.find((m) => m.role === 'assistant' && getMessageText(m).trim());
		const lastUser = [...$messages]
			.reverse()
			.find((m) => m.role === 'user' && !isHiddenMessage(m));
		captureEvent('not_helpful', SESSION_ID, {
			session_id: SESSION_ID,
			current_page: $page.url.pathname,
			user_message: lastUser ? getMessageText(lastUser) : null,
			bot_response: lastBot ? getMessageText(lastBot) : null
		});
		sendHidden("That response wasn't quite right — can you give a more specific or direct answer?");
	}
</script>

<div
	class="flex-col-rev z-50 mb-0 flex max-h-[calc(100dvh-4.5rem)] w-full flex-col flex-nowrap overflow-hidden rounded-t-lg border-t border-stone-200 bg-white sm:left-auto sm:mb-4 sm:max-h-[calc(100dvh-2rem)] sm:rounded-lg sm:border dark:border-stone-800 dark:bg-black"
>
	{#if !$minimized}
		<GreetingMessage {greeting} />

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
						type="button"
						aria-label="Scroll to the latest message"
						on:click={() => {
							scrollToBottom();
						}}
						class="absolute bottom-2 left-1/2 mx-auto block h-8 w-8 -translate-x-1/2 rounded border border-stone-300 bg-stone-200 transition hover:bg-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700"
					>
						<img src={arrowdown} alt="" class="m-auto flex-none dark:invert" />
					</button>
				</div>
			{/if}
			<!-- Render the chat messages -->
			<div class="first:pt-4 {visibleChips.length > 0 ? '' : 'last:pb-6'}">
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
							{#if !isHiddenMessage(message)}
								<UserMessage value={getMessageText(message)} />
							{/if}
						{:else if message.role === 'assistant' && getMessageText(message).trim()}
							<BotMessage
								value={getMessageText(message)}
								isLast={hasAsked && i === $messages.length - 1 && !$isLoading}
								onRetry={retryLastResponse}
								animate={shouldAnimate(message.id)}
								sources={getMessageSources(message)}
								related={getMessageRelated(message)}
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
						<LoadingStream status={getStreamingStatus($messages)} />
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if visibleChips.length > 0}
		<div transition:slide|global={{ duration: 200, easing: cubicOut }}>
			<ChatSuggestions suggestions={visibleChips} onSelect={selectSuggestion} />
		</div>
	{/if}
	<TextInput {isLoading} {handleSubmit} {input} currentPage={$page.url.pathname} />

	<p class="sr-only" aria-live="polite">{announcement}</p>
</div>
