<svelte:options accessors />

<script lang="ts">
	import { slide } from 'svelte/transition';
	import Check from '$lib/assets/check.svelte';
	import Close from '$lib/assets/close.svelte';
	import type { Message } from '@ai-sdk/svelte';
	import { FunctionState, type FunctionMessage } from '$lib/types';

	export let value: Message;

	$: typedValue = value as FunctionMessage;
</script>

<div
	in:slide|global={{ duration: 400 }}
	class="mb-4 ml-12 mr-6 mt-4 flex flex-col gap-1 rounded-2xl border border-stone-200 bg-stone-100 py-1 pl-3 pr-1.5 text-xs font-medium uppercase tracking-wider text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
>
	{#if typedValue.name === 'capture_lead_intent'}
		<div class="my-1 flex gap-3">
			<a
				href="https://www.linkedin.com/in/hunterbryant1/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-blue-600 underline decoration-blue-300 hover:text-blue-700 dark:text-blue-400 dark:decoration-blue-700 dark:hover:text-blue-300"
			>LinkedIn</a>
			<a
				href="mailto:hunter.bryant2016@gmail.com"
				class="text-blue-600 underline decoration-blue-300 hover:text-blue-700 dark:text-blue-400 dark:decoration-blue-700 dark:hover:text-blue-300"
			>Email Hunter</a>
		</div>
	{:else}
		<div class="flex flex-row items-center justify-between">
			<p class="my-1">{typedValue.content}</p>

			{#if typedValue.data === FunctionState.loading}
				<svg
					class="mt-0.5 inline-block h-5 w-5 animate-spin text-slate-400"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					width="24"
					height="24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
			{:else if typedValue.data === FunctionState.success}
				<div class="-mr-0.5 text-emerald-400 dark:text-emerald-600">
					<Check />
				</div>
			{:else}
				<div class="-mr-0.5 text-red-400 dark:text-red-600">
					<Close />
				</div>
			{/if}
		</div>
	{/if}
</div>
