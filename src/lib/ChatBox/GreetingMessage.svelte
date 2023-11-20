<script>
	import huntbotlogo from '$lib/assets/huntbotlogo.webp';
	import { messages } from './MessageStore';

	let greetingResponse =
		'I know, I know. Hear me out, I’m a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗';

	function handleClick() {
		messages.update((m) => [...m, { type: 'user', message: 'Not another GPT' }]);
		messages.update((m) => [...m, { type: 'bot', message: greetingResponse }]);
	}
</script>

<div
	class="flex w-[calc(full-4rem)] shrink-0 basis-16 flex-row flex-nowrap items-center gap-3 rounded-3xl p-2"
>
	<img
		src={huntbotlogo}
		alt="HuntBot&apos;s Avatar"
		class="h-12 flex-none basis-12 rounded-2xl outline outline-1 outline-slate-200"
	/>
	<p class="grow">Hello 👋, I’m HuntBot</p>

	{#if !$messages.length}
		<button
			on:click={handleClick}
			class="h-12 rounded-2xl bg-blue-600 px-3 text-white transition hover:bg-blue-700 hover:shadow-md active:bg-blue-600 active:shadow-none"
		>
			Not another GPT
		</button>
	{/if}

	<hr class="absolute left-4 right-4 top-16 bg-slate-200 peer-focus:hidden" />
</div>
