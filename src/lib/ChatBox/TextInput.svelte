<script lang="ts">
	import arrowup from '$lib/assets/arrow-up.svg';
	import caretdown from '$lib/assets/caret-down.svg';
	import { chatOpen, mobile } from '$lib/nav/navstore';
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { minimized, scrollSuggestions, hoverSuggestions, loadingContextSuggestions } from './MessageStore';
	import type { Writable, Readable } from 'svelte/store';

	export let input: Writable<string>;
	export let handleSubmit: (e: SubmitEvent, options?: Record<string, unknown>) => void;
	export let isLoading: Readable<boolean>;
	export let currentPage: string = '/';
	export let onPlaceholderSelect: ((suggestion: string) => void) | null = null;

	let inputElement: HTMLInputElement;

	$: placeholder = $minimized
		? $loadingContextSuggestions && $hoverSuggestions.length === 0 && $scrollSuggestions.length === 0
			? 'Generating questions...'
			: $hoverSuggestions.length > 0
				? $hoverSuggestions[0]
				: $scrollSuggestions.length > 0
					? $scrollSuggestions[0]
					: 'If you need me... ask away!'
		: 'Message HuntBot';

	$: isMinimizedSuggestion =
		$minimized && ($hoverSuggestions.length > 0 || $scrollSuggestions.length > 0);

	function typeReveal(node: HTMLElement, text: string) {
		let timeouts: ReturnType<typeof setTimeout>[] = [];
		let current = '';
		const FADE_OUT_MS = 120;

		function revealChars(t: string) {
			node.textContent = '';

			const wrapper = document.createElement('span');
			wrapper.style.cssText = 'display:inline-flex;white-space:nowrap';
			node.appendChild(wrapper);

			const chars = t.split('');
			const spans: HTMLSpanElement[] = [];

			for (const char of chars) {
				const span = document.createElement('span');
				span.textContent = char;
				span.style.cssText =
					'display:inline-block;white-space:pre;opacity:0;transform:translateY(4px);transition:opacity 140ms ease-out,transform 140ms ease-out';
				wrapper.appendChild(span);
				spans.push(span);
			}

			requestAnimationFrame(() => {
				spans.forEach((span, i) => {
					timeouts.push(
						setTimeout(() => {
							span.style.opacity = '1';
							span.style.transform = 'translateY(0)';
						}, i * 20)
					);
				});

				const revealDone = chars.length * 20 + 200;
				timeouts.push(
					setTimeout(() => {
						const overflow = wrapper.scrollWidth - node.clientWidth;
						if (overflow > 0) {
							const speed = 30;
							const duration = overflow * speed;
							wrapper.style.transition = `transform ${duration}ms linear`;
							wrapper.style.transform = `translateX(-${overflow}px)`;
						}
					}, revealDone + 800)
				);
			});
		}

		function render(t: string, fadeOut: boolean) {
			timeouts.forEach(clearTimeout);
			timeouts = [];
			current = t;

			if (fadeOut && node.children.length > 0) {
				node.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
				node.style.opacity = '0';
				timeouts.push(
					setTimeout(() => {
						node.style.transition = '';
						node.style.opacity = '1';
						revealChars(t);
					}, FADE_OUT_MS)
				);
			} else {
				revealChars(t);
			}
		}

		render(text, false);

		return {
			update(newText: string) {
				if (newText !== current) render(newText, true);
			},
			destroy() {
				timeouts.forEach(clearTimeout);
			}
		};
	}

	async function handleLocalSubmit(event: SubmitEvent) {
		minimized.set(false);

		if ($mobile) {
			inputElement.blur();
		}

		handleSubmit(event, { body: { currentPage } });
	}

	function focusInput() {
		if (isMinimizedSuggestion && onPlaceholderSelect) {
			onPlaceholderSelect(placeholder);
			return;
		}
		if (inputElement) {
			inputElement.focus();
		}
	}
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions-->
<form
	on:submit|preventDefault={handleLocalSubmit}
	on:click={focusInput}
	on:keydown={focusInput}
	class="relative flex w-[calc(full-4rem)] shrink-0 basis-12 cursor-text flex-row-reverse flex-nowrap items-center gap-1 overflow-visible rounded-md p-1 text-stone-800 outline-2 -outline-offset-2 focus-within:outline focus-within:outline-blue-200 dark:text-stone-200 dark:focus-within:outline-blue-800"
>
	{#if $input.trim() === '' && $minimized}
		<button
			on:click={() => {
				minimized.set(false);
				chatOpen.set(true);
			}}
			class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-slate-200 active:shadow-none dark:bg-black dark:hover:bg-stone-900 dark:active:bg-slate-800"
		>
			<img src={caretdown} alt="Caret down icon" class="m-auto flex-none -scale-y-100" />
		</button>
	{:else}
		<button
			type="submit"
			class="peer aspect-square h-12 basis-12 rounded bg-blue-600 transition hover:bg-blue-700 active:bg-blue-600 disabled:bg-blue-200 dark:bg-blue-500 dark:hover:bg-blue-600 dark:active:bg-blue-500 dark:disabled:bg-blue-900"
			disabled={$input.trim() === '' || $isLoading}
		>
			<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none dark:invert" />
		</button>
	{/if}

	<div class="relative min-w-0 grow {$minimized ? 'ml-0' : 'mx-2'}">
		<input
			placeholder={!$minimized ? 'Message HuntBot' : ''}
			class="peer w-full bg-transparent focus:outline-none"
			bind:value={$input}
			bind:this={inputElement}
			inputmode="search"
		/>
		{#if $minimized && $input.trim() === ''}
			<span
				class="pointer-events-none absolute inset-0 flex items-center overflow-x-hidden overflow-y-visible whitespace-nowrap text-stone-400 dark:text-stone-500"
				use:typeReveal={placeholder}
			/>
		{/if}
	</div>
	<hr class="absolute inset-x-2 -top-px border-slate-200 peer-focus:hidden dark:border-slate-800" />

	{#if $minimized}
		<Huntbotlogo />
	{/if}
</form>
