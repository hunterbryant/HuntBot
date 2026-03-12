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
		class="no-scrollbar flex min-h-[44px] items-center gap-1.5 overflow-x-auto overflow-y-hidden px-4 pb-3 pt-4"
		in:fade|global={{ duration: 150 }}
	>
		{#each suggestions as suggestion, i (suggestion)}
			<button
				in:fly={{ y: 8, duration: 200, delay: i * 120 }}
				out:fade={{ duration: 100 }}
				on:click={() => onSelect(suggestion)}
				class="flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 px-3.5 text-sm text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 active:bg-slate-200 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:active:bg-slate-800"
				use:typeReveal={suggestion}
			/>
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
