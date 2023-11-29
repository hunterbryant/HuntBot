<script lang="ts">
	import huntbotlogo from '$lib/assets/huntbotlogo.webp';
	import { slide } from 'svelte/transition';

	export let value: string;
</script>

<div
	in:slide
	class="flex w-[calc(full-4rem)] shrink-0 basis-16 flex-row flex-nowrap items-start gap-3 rounded-3xl p-2"
>
	<img
		src={huntbotlogo}
		alt="HuntBot&apos;s Avatar"
		class="h-11 w-11 flex-none rounded-2xl outline outline-1 outline-slate-200"
	/>

	<p class="mr-6 mt-2 grow whitespace-pre-line">
		{#if value == ''}
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
			{@html value}
		{/if}
	</p>
</div>
