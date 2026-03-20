<script lang="ts">
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { slide, fade } from 'svelte/transition';

	export let value: string;
	export let isLast: boolean = false;
	export let onRetry: (() => void) | null = null;
	export let animate: boolean = true;

	$: updatedVal = value;

	let retried = false;

	function handleRetry() {
		retried = true;
		onRetry?.();
	}

	const KEYFRAMES_ID = 'stream-reveal-kf';

	function ensureKeyframes() {
		if (document.getElementById(KEYFRAMES_ID)) return;
		const style = document.createElement('style');
		style.id = KEYFRAMES_ID;
		style.textContent = `@keyframes streamCharIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`;
		document.head.appendChild(style);
	}

	function streamReveal(node: HTMLElement, text: string) {
		ensureKeyframes();

		const STAGGER = 10;

		let current = '';
		let settleTimer: ReturnType<typeof setTimeout> | null = null;
		const appendTimers: ReturnType<typeof setTimeout>[] = [];
		let startTime: number | null = null;
		let charIndex = 0;

		function clearAppendTimers() {
			for (const t of appendTimers) clearTimeout(t);
			appendTimers.length = 0;
		}

		if (!animate) {
			current = text;
			node.textContent = text;
		}

		function render(newText: string) {
			const prevLen = current.length;
			current = newText;

			if (newText.length < prevLen) {
				if (settleTimer) clearTimeout(settleTimer);
				clearAppendTimers();
				node.textContent = newText;
				startTime = null;
				charIndex = 0;
				return;
			}

			const delta = newText.slice(prevLen);
			if (!delta) return;

			if (startTime === null) startTime = performance.now();
			const elapsed = performance.now() - startTime;

			let lastDelay = 0;
			const chunks = delta.match(/\S+|\s+/g) || [];

			for (const chunk of chunks) {
				const isSpace = /^\s+$/.test(chunk);

				if (isSpace) {
					for (const ch of chunk) {
						const delay = Math.max(0, charIndex * STAGGER - elapsed);
						charIndex++;
						lastDelay = delay;
						const span = document.createElement('span');
						span.textContent = ch;
						span.style.cssText = `display:inline;opacity:0;animation:streamCharIn 140ms ease-out 0ms forwards`;
						appendTimers.push(
							setTimeout(() => {
								node.appendChild(span);
							}, delay)
						);
					}
				} else {
					const wordSpan = document.createElement('span');
					wordSpan.style.cssText = 'white-space:nowrap';
					let wordMounted = false;

					for (const ch of chunk) {
						const delay = Math.max(0, charIndex * STAGGER - elapsed);
						charIndex++;
						lastDelay = delay;
						const charSpan = document.createElement('span');
						charSpan.textContent = ch;
						charSpan.style.cssText = `display:inline-block;opacity:0;animation:streamCharIn 140ms ease-out 0ms forwards`;
						appendTimers.push(
							setTimeout(() => {
								if (!wordMounted) {
									node.appendChild(wordSpan);
									wordMounted = true;
								}
								wordSpan.appendChild(charSpan);
							}, delay)
						);
					}
				}
			}

			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(() => {
				clearAppendTimers();
				const before = node.offsetHeight;
				node.textContent = current;
				const after = node.offsetHeight;

				if (before !== after) {
					node.style.height = before + 'px';
					node.style.overflow = 'hidden';
					node.style.transition = 'height 200ms ease-out';
					requestAnimationFrame(() => {
						node.style.height = after + 'px';
						const onEnd = () => {
							node.style.height = '';
							node.style.overflow = '';
							node.style.transition = '';
							node.removeEventListener('transitionend', onEnd);
						};
						node.addEventListener('transitionend', onEnd, { once: true });
					});
				}

				startTime = null;
				charIndex = 0;
			}, lastDelay + 200);
		}

		if (animate) render(text);

		return {
			update(newText: string) {
				render(newText);
			},
			destroy() {
				if (settleTimer) clearTimeout(settleTimer);
				clearAppendTimers();
			}
		};
	}
</script>

<div
	in:slide|global
	class="group relative flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-start gap-1 rounded px-1 text-stone-800 dark:text-stone-200"
>
	<Huntbotlogo />

	{#if updatedVal === ' '}
		<p class="mr-6 mt-3 grow whitespace-pre-line">
			<svg
				class="inline-block h-5 w-5 animate-spin text-slate-400"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
			>
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
				></circle>
				<path
					class="opacity-75"
					fill="currentColor"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
				></path>
			</svg>
		</p>
	{:else}
		<div class="mr-6 mt-3 grow">
			<p
				class="whitespace-pre-line font-normal text-stone-600 dark:text-stone-400"
				in:slide|global={{ duration: 400 }}
				use:streamReveal={value}
			></p>
			{#if isLast && !retried}
				<button
					on:click={handleRetry}
					title="This wasn't helpful"
					transition:fade={{ duration: 150 }}
					class="mt-1 flex items-center gap-1 text-xs text-stone-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-400"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z" />
						<path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
					</svg>
					Not helpful
				</button>
			{/if}
		</div>
	{/if}
</div>
