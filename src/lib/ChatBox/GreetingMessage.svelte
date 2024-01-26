<script lang="ts">
	import huntbotlogo from '$lib/assets/huntbotlogo.svg';
	import { botEngaged, messages } from './MessageStore';
	import caretdown from '$lib/assets/caret-down.svg';
	import { chatOpen } from '$lib/nav/navstore';
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';

	export let minimized: boolean;
	export let greeting: string;

	let greetingResponse =
		'I know, I know, another chatbot. Hear me out, I’m a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗';

	function handleGreet() {
		// Insert blank value for loading state
		messages.update((m) => [...m, { type: 'bot', message: '' }]);

		botEngaged.set(true);
		minimized = false;
		chatOpen.set(true);

		setTimeout(() => {
			messages.update((m) => {
				m[m.length - 1] = { type: 'bot', message: greetingResponse };
				return m;
			});
		}, 600);
	}
</script>

<div
	class="text-stone-800 flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-center gap-1 rounded p-1 dark:text-stone-200"
>
	<Huntbotlogo />
	<p class="text-stone-600 grow dark:text-stone-400">{greeting}</p>

	{#if minimized}
		<button
			on:click={handleGreet}
			class="text-stone-50 bg-blue-600 h-12 rounded px-3 transition hover:bg-blue-700 active:bg-blue-600 dark:text-stone-950"
		>
			Ask HuntBot
		</button>
	{:else}
		<button
			on:click={() => {
				minimized = true;
				chatOpen.set(false);
			}}
			class="peer bg-white h-12 basis-12 rounded transition hover:bg-stone-100 active:bg-slate-200 dark:bg-black dark:hover:bg-stone-900 dark:active:bg-slate-800 active:shadow-none"
		>
			<img src={caretdown} alt="Caret down icon" class="m-auto flex-none" />
		</button>
		<hr
			class="border-slate-200 absolute inset-x-2 top-14 dark:border-slate-800 peer-focus:hidden"
		/>
	{/if}
</div>
