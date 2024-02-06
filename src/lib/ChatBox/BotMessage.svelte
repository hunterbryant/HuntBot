<script lang="ts">
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { slide } from 'svelte/transition';

	export let value: string;

	$: updatedVal = value;
</script>

<div
	in:slide|global
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-start gap-1 rounded px-1 text-stone-800 dark:text-stone-200"
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
		<p
			class="mr-6 mt-3 grow whitespace-pre-line font-normal text-stone-600 dark:text-stone-400"
			in:slide|global={{ duration: 400 }}
		>
			{@html value}
		</p>
	{/if}
</div>
