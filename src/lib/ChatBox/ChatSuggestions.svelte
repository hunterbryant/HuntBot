<script lang="ts">
	import { fade } from 'svelte/transition';

	export let suggestions: string[] = [];
	export let onSelect: (suggestion: string) => void;
</script>

{#if suggestions.length > 0}
	<div
		class="no-scrollbar flex gap-2 overflow-x-auto px-2 pb-2 pt-1"
		transition:fade|global={{ duration: 150 }}
	>
		{#each suggestions as suggestion (suggestion)}
			<button
				on:click={() => onSelect(suggestion)}
				class="shrink-0 rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs text-stone-600 transition hover:border-stone-400 hover:bg-stone-100 active:bg-stone-200 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:active:bg-stone-700"
			>
				{suggestion}
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
