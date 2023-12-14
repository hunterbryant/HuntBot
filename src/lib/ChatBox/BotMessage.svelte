<script lang="ts">
	import huntbotlogo from '$lib/assets/huntbotlogo.webp';
	import { slide } from 'svelte/transition';
	import { getContext } from 'svelte';

	export let value: string;

	interface ScrollContext {
		scrollToBottom: () => void;
	}

	// Access the chat box's scroll function
	const { scrollToBottom } = getContext<ScrollContext>('scroll');
</script>

<div
	in:slide
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-start gap-1 rounded p-2"
>
	<img src={huntbotlogo} alt="HuntBot&apos;s Avatar" class="h-12 flex-none basis-12" />

	{#if value == ''}
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
			class="mr-6 mt-0 grow whitespace-pre-line font-normal text-stone-600"
			in:slide={{ duration: 400 }}
			on:introend={() => {
				scrollToBottom();
			}}
		>
			{@html value}
		</p>
	{/if}
</div>
