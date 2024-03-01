<script lang="ts">
	import { botEngaged, minimized } from './MessageStore';
	import caretdown from '$lib/assets/caret-down.svg';
	import { chatOpen } from '$lib/nav/navstore';
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';

	export let greeting: string;

	function handleGreet() {
		botEngaged.set(true);
		minimized.set(false);
		chatOpen.set(true);
	}
</script>

<div
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-center gap-1 rounded p-1 text-stone-800 dark:text-stone-200"
>
	<Huntbotlogo />
	<p class="grow text-stone-600 dark:text-stone-400">{greeting}</p>

	{#if $minimized}
		<button
			on:click={handleGreet}
			class="h-12 rounded bg-blue-600 px-3 pt-0.5 text-stone-50 transition hover:bg-blue-700 active:bg-blue-600 dark:bg-blue-500 dark:text-stone-950 dark:hover:bg-blue-600 dark:active:bg-blue-500"
		>
			Ask HuntBot
		</button>
	{:else}
		<button
			on:click={() => {
				minimized.set(true);
				chatOpen.set(false);
			}}
			class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-slate-200 active:shadow-none dark:bg-black dark:hover:bg-stone-900 dark:active:bg-slate-800"
		>
			<img src={caretdown} alt="Caret down icon" class="m-auto flex-none" />
		</button>
		<hr
			class="absolute inset-x-2 top-14 border-slate-200 peer-focus:hidden dark:border-slate-800"
		/>
	{/if}
</div>
