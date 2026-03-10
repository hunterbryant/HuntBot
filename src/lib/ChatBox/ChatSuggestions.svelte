<script lang="ts">
	import { fade } from 'svelte/transition';

	export let suggestions: string[] = [];
	export let onSelect: (suggestion: string) => void;
</script>

{#if suggestions.length > 0}
	<div
		class="no-scrollbar flex min-h-[44px] items-center gap-1.5 overflow-x-auto overflow-y-hidden px-2"
		transition:fade|global={{ duration: 150 }}
	>
		{#each suggestions as suggestion (suggestion)}
			<button
				on:click={() => onSelect(suggestion)}
				class="flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-stone-300 px-3.5 text-xs text-stone-600 transition hover:border-stone-400 hover:bg-stone-100 active:bg-stone-200 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-900 dark:active:bg-stone-800"
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
