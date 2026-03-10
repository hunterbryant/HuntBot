<script lang="ts">
	import { fade } from 'svelte/transition';

	export let suggestions: string[] = [];
	export let onSelect: (suggestion: string) => void;
</script>

{#if suggestions.length > 0}
	<div
		class="no-scrollbar flex min-h-[44px] items-center gap-[2px] overflow-x-auto overflow-y-hidden px-2"
		transition:fade|global={{ duration: 150 }}
	>
		{#each suggestions as suggestion (suggestion)}
			<button
				on:click={() => onSelect(suggestion)}
				class="shrink-0 rounded bg-stone-200 p-1 pb-[2px] text-xs uppercase tracking-wider text-stone-900 transition hover:bg-stone-300 active:bg-stone-400 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700 dark:active:bg-stone-600"
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
