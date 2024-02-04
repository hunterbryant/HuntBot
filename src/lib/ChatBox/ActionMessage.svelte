<script lang="ts">
	import { getContext } from 'svelte';
	import { slide } from 'svelte/transition';
	import Check from '$lib/assets/check.svelte';
	import type { ChatObject } from './MessageStore';

	export let value: ChatObject;

	interface ScrollContext {
		scrollToBottom: () => void;
	}

	

	// Access the chat box's scroll function
	const { scrollToBottom } = getContext<ScrollContext>('scroll');
</script>

<div
	in:slide|global={{ duration: 400 }}
	on:introend={() => {
		scrollToBottom();
	}}
	class="mb-4 ml-12 mr-6 mt-4 flex h-8 w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-center justify-between gap-1 rounded-full bg-stone-200 pl-3 pr-1.5 text-xs font-medium uppercase tracking-wider text-stone-700 dark:bg-stone-800 dark:text-stone-300"
>
	{value.message}

	{#if !value.state.completed}
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
	{:else}
		<div class="-mr-0.5 text-emerald-400 dark:text-emerald-600">
			<Check />
		</div>
	{/if}
</div>
