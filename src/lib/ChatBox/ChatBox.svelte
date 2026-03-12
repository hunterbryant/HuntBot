<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import ChatSuggestions from './ChatSuggestions.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { derived } from 'svelte/store';
	import { afterNavigate } from '$app/navigation';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import arrowdown from '$lib/assets/arrow-down.svg';
	import { navEngaged, chatOpen, mobile } from '$lib/nav/navstore';
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
		fetchScrollSuggestions,
		fetchHoverSuggestions,
		triggerProactiveOpener,
		SESSION_ID
	} from './MessageStore';
	import { captureEvent } from '$lib/analytics';
	import LoadingStream from './LoadingStream.svelte';

	const { messages, isLoading, handleSubmit, input, append } = chat();

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

	// Scroll down when new suggestion chips appear so they don't push content out of view
	$: if (!$minimized && ($suggestions.length > 0 || $hoverSuggestions.length > 0)) {
		setTimeout(() => scrollToBottom(), 200);
	}

	// Gate: hold back all pre-conversation suggestions until the greeting has been read
	let readyForSuggestions = false;
	let greetingReadTimer: ReturnType<typeof setTimeout> | null = null;

	$: {
		const greetingLoaded =
			$botEngaged &&
			!$minimized &&
			$messages.some((m) => m.role === 'assistant' && m.content.trim().length > 1);
		const hasUser = $messages.some((m) => m.role === 'user');

		if (hasUser) {
			readyForSuggestions = true;
		} else if (greetingLoaded && !readyForSuggestions) {
			if (!greetingReadTimer) {
				greetingReadTimer = setTimeout(() => {
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
				setTimeout(() => fetchSuggestions($messages, $page.url.pathname), 2000);
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

	// --- Scroll-aware suggestions via IntersectionObserver + scroll-depth fallback ---
	// Primary: observes h1–h4 headings and first heading within Prismic slice containers.
	// Fallback: on heading-sparse pages (e.g. one big TextBlock), fires at scroll-depth
	// milestones (25%, 50%, 75%) so long-form content still gets fresh suggestions.
	// Both share the same fetch budget (max 5 per page, 3s dwell before firing).

	const DWELL_MS = 3000;
	const MAX_FETCHES = 5;
	const MIN_OBSERVABLE = 3;
	const DEPTH_MILESTONES = [25, 50, 75];

	let dwellTimer: ReturnType<typeof setTimeout> | null = null;
	let sectionObserver: IntersectionObserver | null = null;
	let fetchedHeadings = new Set<string>();
	let fetchCount = 0;

	let scrollFallbackTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollFallbackHandler: (() => void) | null = null;
	let milestonesFired = new Set<number>();

	function getScrollDepth(): number {
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
		const docHeight = document.documentElement.scrollHeight - viewportHeight;
		return docHeight > 0 ? Math.round((window.scrollY / docHeight) * 100) : 0;
	}

	function canFetchScroll(): boolean {
		if (fetchCount >= MAX_FETCHES) return false;
		return true;
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
					if (depth >= milestone && !milestonesFired.has(milestone) && canFetchScroll()) {
						milestonesFired.add(milestone);
						fetchCount++;
						fetchScrollSuggestions(pathname, depth, null);
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
						if (dwellTimer) clearTimeout(dwellTimer);
						dwellTimer = setTimeout(() => {
							if (!canFetchScroll()) return;
							fetchedHeadings.add(heading);
							fetchCount++;
							fetchScrollSuggestions(pathname, getScrollDepth(), heading);
						}, DWELL_MS);
					} else if (!entry.isIntersecting && dwellTimer) {
						clearTimeout(dwellTimer);
						dwellTimer = null;
					}
				}
			},
			{ threshold: 0.5 }
		);

		observables.forEach((el) => sectionObserver!.observe(el));
	}

	function resetScrollState() {
		if (sectionObserver) sectionObserver.disconnect();
		if (dwellTimer) clearTimeout(dwellTimer);
		dwellTimer = null;
		if (scrollFallbackTimer) clearTimeout(scrollFallbackTimer);
		scrollFallbackTimer = null;
		if (scrollFallbackHandler) {
			window.removeEventListener('scroll', scrollFallbackHandler);
			scrollFallbackHandler = null;
		}
		fetchedHeadings.clear();
		milestonesFired.clear();
		fetchCount = 0;
		scrollSuggestions.set([]);
		teardownHoverObserver();
	}

	// --- Hover-aware suggestions (desktop only) ---
	// When the visitor dwells on a content block for 2s, fetch suggestions
	// specific to that passage. Clears after 15s of no hover activity.

	const HOVER_DWELL_MS = 2000;
	const HOVER_DECAY_MS = 15000;
	const HOVER_COOLDOWN_MS = 3000;
	const MAX_HOVER_FETCHES = 3;

	let hoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
	let hoverDecayTimer: ReturnType<typeof setTimeout> | null = null;
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

		if ($mobile) return;

		const targets = document.querySelectorAll(
			'[data-slice-type] p, [data-slice-type] blockquote, [data-slice-type] figcaption'
		);

		targets.forEach((el) => {
			const onEnter = () => {
				if (hoverDecayTimer) {
					clearTimeout(hoverDecayTimer);
					hoverDecayTimer = null;
				}
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
					flashContextOverlay(el);
					fetchHoverSuggestions(pathname, context);
				}, HOVER_DWELL_MS);
			};

			const onLeave = () => {
				if (hoverDwellTimer) {
					clearTimeout(hoverDwellTimer);
					hoverDwellTimer = null;
				}
				if (hoverDecayTimer) clearTimeout(hoverDecayTimer);
				hoverDecayTimer = setTimeout(() => {
					hoverSuggestions.set([]);
				}, HOVER_DECAY_MS);
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
		if (hoverDecayTimer) clearTimeout(hoverDecayTimer);
		hoverDecayTimer = null;
		hoverFetchCount = 0;
		hoveredFingerprints.clear();
		hoverSuggestions.set([]);
	}

	onMount(() => {
		if (canFetchScroll()) {
			fetchCount++;
			fetchScrollSuggestions($page.url.pathname, getScrollDepth(), null);
		}
		setupHeadingObserver($page.url.pathname);
		setupHoverObserver($page.url.pathname);
	});

	onDestroy(() => {
		resetScrollState();
	});

	afterNavigate(({ to }) => {
		const path = to?.url.pathname ?? $page.url.pathname;
		resetScrollState();
		setTimeout(() => {
			setupHeadingObserver(path);
			setupHoverObserver(path);
		}, 300);
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
			<div class="first:pt-4 {$activeSuggestions.length > 0 && !$isLoading && $input.trim() === '' ? '' : 'last:pb-6'}">
				{#each $messages as message, i}
					<div
						in:slide|global={{ duration: 400 }}
						on:introend={() => {
							scrollToBottom();
							setTimeout(() => {
								scrollToBottom();
							}, 400);
						}}
					>
					{#if message.role === 'user'}
						<UserMessage value={message.content} />
					{:else if message.role === 'assistant' && message.content.trim()}
						<BotMessage
							value={message.content}
							isLast={i === $messages.length - 1 && !$isLoading}
							onRetry={retryLastResponse}
							animate={shouldAnimate(message.id)}
						/>
					{:else if message.role === 'function'}
						<ActionMessage value={message} />
					{/if}
					</div>
				{/each}
				{#if $isLoading && $messages[$messages.length - 1].role !== 'assistant'}
					<div
						in:slide|global={{ duration: 400 }}
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
		<TextInput {isLoading} {handleSubmit} {input} currentPage={$page.url.pathname} onPlaceholderSelect={selectSuggestion} />
	{/if}
</div>
