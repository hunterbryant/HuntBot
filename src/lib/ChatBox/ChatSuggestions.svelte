<script lang="ts">
	import { fly, fade } from 'svelte/transition';

	export let suggestions: string[] = [];
	export let onSelect: (suggestion: string) => void;

	function typeReveal(node: HTMLElement, text: string) {
		let timeouts: ReturnType<typeof setTimeout>[] = [];
		let current = '';
		const FADE_OUT_MS = 120;

		function revealChars(t: string) {
			node.textContent = '';

			const chars = t.split('');
			const spans: HTMLSpanElement[] = [];

			for (const char of chars) {
				const span = document.createElement('span');
				span.textContent = char;
				span.style.cssText =
					'display:inline-block;white-space:pre;opacity:0;transform:translateY(4px);transition:opacity 140ms ease-out,transform 140ms ease-out';
				node.appendChild(span);
				spans.push(span);
			}

			requestAnimationFrame(() => {
				spans.forEach((span, i) => {
					timeouts.push(
						setTimeout(() => {
							span.style.opacity = '1';
							span.style.transform = 'translateY(0)';
						}, i * 10)
					);
				});
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
</script>

{#if suggestions.length > 0}
	<div
		class="no-scrollbar flex items-center gap-2 overflow-x-auto overflow-y-hidden px-2 py-2"
		in:fade|global={{ duration: 150 }}
	>
		{#each suggestions as suggestion, i (i + '|' + suggestion)}
			<button
				type="button"
				in:fly={{ y: 8, duration: 200, delay: i * 120 }}
				out:fade|global={{ duration: 100 }}
				on:click={() => onSelect(suggestion)}
				aria-label={suggestion}
				class="inline-flex shrink-0 items-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-left transition hover:border-stone-300 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:bg-stone-100 dark:border-stone-700 dark:bg-black dark:hover:border-stone-600 dark:hover:bg-stone-900/40 dark:active:bg-stone-900"
			>
				<span
					class="whitespace-nowrap text-sm font-normal leading-normal text-stone-500 dark:text-stone-400"
					use:typeReveal={suggestion}
				></span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
