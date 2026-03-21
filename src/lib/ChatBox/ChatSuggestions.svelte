<script lang="ts">
	import { fly, fade } from 'svelte/transition';

	export let suggestions: string[] = [];
	export let onSelect: (suggestion: string) => void;
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
				out:fade={{ duration: 100 }}
				on:click={() => onSelect(suggestion)}
				aria-label={suggestion}
				class="inline-flex shrink-0 items-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-left transition hover:border-stone-300 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:bg-stone-100 dark:border-stone-700 dark:bg-black dark:hover:border-stone-600 dark:hover:bg-stone-900/40 dark:active:bg-stone-900"
			>
				<span
					class="whitespace-nowrap text-sm font-normal leading-normal text-stone-500 dark:text-stone-500"
				>{suggestion}</span>
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
