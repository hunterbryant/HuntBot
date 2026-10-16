<script lang="ts">
	import caretdown from '$lib/assets/caret-down.svg';
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { closeChat } from './MessageStore.svelte';

	export let greeting: string;
</script>

<!-- Header of the open chat. The closed chat is just the input bar (TextInput). -->
<div
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-center gap-1 rounded p-1 text-stone-600 dark:text-stone-400"
>
	<Huntbotlogo mode="sketchy" />
	<p class="grow text-stone-600 dark:text-stone-400">{greeting}</p>

	<button
		type="button"
		aria-label="Minimize chat"
		on:click={closeChat}
		class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-stone-200 active:shadow-none dark:bg-black dark:hover:bg-stone-900 dark:active:bg-stone-800"
	>
		<img src={caretdown} alt="" class="m-auto flex-none" />
	</button>
	<hr class="absolute inset-x-2 top-14 border-stone-200 peer-focus:hidden dark:border-stone-700" />
</div>
