<script lang="ts">
	import huntbotlogo from '$lib/assets/huntbotlogo.svg';
	import { messages } from './MessageStore';
	import caretdown from '$lib/assets/caret-down.svg';

	export let minimized: boolean;

	let greetingResponse =
		'I know, I know. Hear me out, I’m a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗';

	function handleGreet() {
		messages.update((m) => [...m, { type: 'user', message: 'Not another GPT' }]);
		setTimeout(() => {
			messages.update((m) => [...m, { type: 'bot', message: greetingResponse }]);
		}, 600);
		minimized = false;
	}

	function handleMinimize() {
		minimized = true;
	}
</script>

<div
	class="flex w-[calc(full-4rem)] shrink-0 basis-12 flex-row flex-nowrap items-center gap-1 rounded p-1"
>
	<img src={huntbotlogo} alt="HuntBot&apos;s Avatar" class="h-12 flex-none basis-12" />
	<p class="grow text-stone-600">Hey 👋</p>

	{#if minimized}
		<button
			on:click={handleGreet}
			class="h-12 rounded bg-blue-600 px-3 text-stone-50 transition hover:bg-blue-700 active:bg-blue-600"
		>
			Ask HuntBot
		</button>
	{:else}
		<button
			on:click={handleMinimize}
			class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-slate-200 active:shadow-none"
		>
			<img src={caretdown} alt="Caret down icon" class="m-auto flex-none" />
		</button>
		<hr class="absolute inset-x-2 top-14 bg-slate-200 peer-focus:hidden" />
	{/if}
</div>
