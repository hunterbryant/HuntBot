<script lang="ts">
	import arrowup from '$lib/assets/arrow-up.svg';
	import { messages } from './MessageStore';

	let message = '';
	let inputElement: HTMLInputElement;

	function handleSubmit() {
		messages.update((m) => [...m, { type: 'user', message: message }]);
		messages.update((m) => [...m, { type: 'bot', message: 'Example HuntBot message' }]);

		// Clear the message after sending
		message = '';
	}

	function focusInput() {
		if (inputElement) {
			inputElement.focus(); // Focus the input element
		}
	}
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions-->
<form
	on:submit|preventDefault={handleSubmit}
	on:click={focusInput}
	on:keydown={focusInput}
	class="flex w-[calc(full-4rem)] shrink-0 basis-16 cursor-text flex-row-reverse flex-nowrap items-center gap-3 overflow-visible rounded-3xl p-2 outline-2 -outline-offset-2 focus-within:outline focus-within:outline-blue-200"
>
	<button
		type="submit"
		class="peer h-12 basis-12 rounded-2xl bg-blue-600 transition hover:bg-blue-700 hover:shadow-md active:bg-blue-600 active:shadow-none disabled:bg-blue-200 disabled:shadow-none"
		disabled={message.trim() === ''}
	>
		<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none" />
	</button>
	<input
		placeholder="Message HuntBot"
		class="peer ml-2 min-w-0 grow bg-transparent focus:outline-none"
		bind:value={message}
		bind:this={inputElement}
	/>
	<hr class="absolute bottom-16 left-4 right-4 bg-slate-200 peer-focus:hidden" />
</form>
