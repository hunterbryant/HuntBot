<script lang="ts">
	import { fade } from 'svelte/transition';

	export let suggestions: string[] = [];
	export let onSelect: (suggestion: string) => void;
</script>

{#if suggestions.length > 0}
	<div
		class="no-scrollbar flex min-h-[44px] items-center gap-1.5 overflow-x-auto overflow-y-hidden px-2 pb-6 pt-4"
		transition:fade|global={{ duration: 150 }}
	>
		{#each suggestions as suggestion, i (suggestion)}
			<button
				in:fade={{ duration: 200, delay: i * 60 }}
				out:fade={{ duration: 100 }}
				on:click={() => onSelect(suggestion)}
				class="flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 px-3.5 text-sm text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 active:bg-slate-200 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:active:bg-slate-800"
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
