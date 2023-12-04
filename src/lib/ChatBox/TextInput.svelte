<script lang="ts">
	import arrowup from '$lib/assets/arrow-up.svg';
	import { messages } from './MessageStore';
	import huntbotlogo from '$lib/assets/huntbotlogo.webp';
	import { get } from 'svelte/store';

	let message = '';
	let inputElement: HTMLInputElement;
	let placeholder = 'Message HuntBot';
	let chatSessionId: string;
	let awaitingBotResponse = false;

	export let minimized: boolean;

	async function handleSubmit() {
		let inputMessage: string = message;

		// Clear the message after sending
		message = '';
		minimized = false;
		awaitingBotResponse = true;

		// Add the user message
		messages.update((m) => [...m, { type: 'user', message: inputMessage }]);

		// Insert blank value for loading state
		messages.update((m) => [...m, { type: 'bot', message: '' }]);

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				body: JSON.stringify({
					message: inputMessage,
					sessionId: chatSessionId
				}),
				headers: {
					'Content-Type': 'application/json'
				}
			});

			const botResponse = await response.json();
			chatSessionId = botResponse.threadId;

			// Replace the last blank message with the API response
			messages.update((m) => {
				m[m.length - 1] = { type: 'bot', message: botResponse.message };
				return m;
			});
		} catch (error) {
			messages.update((m) => {
				m[m.length - 1] = { type: 'bot', message: `Uh oh, I'm not thinking straight... ${error}` };
				return m;
			});
		} finally {
			awaitingBotResponse = false;
		}
	}

	function focusInput() {
		if (inputElement) {
			inputElement.focus(); // Focus the input element
			placeholder = 'Message HuntBot';
		}
	}

	$: if (minimized) {
		placeholder = 'If you need me... ask away!';
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
		disabled={message.trim() === '' || awaitingBotResponse}
	>
		<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none" />
	</button>
	<input
		{placeholder}
		class="peer min-w-0 grow bg-transparent focus:outline-none {minimized ? 'ml-0' : 'ml-2'}"
		bind:value={message}
		bind:this={inputElement}
	/>

	<!-- Show HuntBot icon when chatbox is minimized -->
	{#if minimized}
		<img
			src={huntbotlogo}
			alt="HuntBot&apos;s Avatar"
			class="h-12 flex-none basis-12 rounded-2xl outline outline-1 outline-slate-200"
		/>
	{/if}
	<hr class="absolute bottom-16 left-4 right-4 bg-slate-200 peer-focus:hidden" />
</form>
