<script lang="ts">
	import arrowup from '$lib/assets/arrow-up.svg';
	import { messages } from './MessageStore';
	import huntbotlogo from '$lib/assets/huntbotlogo.webp';
	import { SupportedActions, type BotAction, SupportedRoutes } from '$lib/types.d.js';
	import { goto } from '$app/navigation';
	import caretdown from '$lib/assets/caret-down.svg';

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

		inputElement.blur();

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

			if (!response.ok) {
				throw new Error(`${response.status} ${response.statusText}`);
			}

			const botResponse = await response.json();
			chatSessionId = botResponse.threadId;
			messages.update((m) => {
				m[m.length - 1] = { type: 'bot', message: botResponse.message };
				return m;
			});
			handleActions(botResponse.actions);
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

	function handleActions(actions: BotAction[]) {
		actions.forEach((action) => {
			console.log(action.arguments);
			if (action.name == SupportedActions.minimize_chat) {
				messages.update((m) => [...m, { type: 'bot', message: 'Minimized the chat' }]);
				minimized = true;
			} else if (action.name == SupportedActions.route_to_page) {
				messages.update((m) => [
					...m,
					{ type: 'bot', message: `Routing you to page: ${action.arguments.page}` }
				]);
				switch (action.arguments.page as unknown as SupportedRoutes) {
					case SupportedRoutes.gathers:
						goto(`/case-studies/gathers`);
						break;
					case SupportedRoutes.home:
						goto('/');
						break;
					case SupportedRoutes.dovetail:
					case SupportedRoutes.karooTwo:
					case SupportedRoutes.dashboard:
					case SupportedRoutes.inSearchOfBirth:
						break;
				}
			}
		});
	}
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions-->
<form
	on:submit|preventDefault={handleSubmit}
	on:click={focusInput}
	on:keydown={focusInput}
	class="relative flex w-[calc(full-4rem)] shrink-0 basis-12 cursor-text flex-row-reverse flex-nowrap items-center gap-1 overflow-visible rounded-md p-1 outline-2 -outline-offset-2 focus-within:outline focus-within:outline-blue-200"
>
	{#if message.trim() === '' && minimized}
		<button
			on:click={() => {
				minimized = false;
			}}
			class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-slate-200 active:shadow-none"
		>
			<img src={caretdown} alt="Caret down icon" class="m-auto flex-none -scale-y-100" />
		</button>
	{:else}
		<button
			type="submit"
			class="peer aspect-square h-12 basis-12 rounded bg-blue-600 transition hover:bg-blue-700 active:bg-blue-600 disabled:bg-blue-200"
			disabled={message.trim() === '' || awaitingBotResponse}
		>
			<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none" />
		</button>
	{/if}

	<input
		{placeholder}
		class="peer min-w-0 grow bg-transparent focus:outline-none {minimized ? 'ml-0' : 'mx-2'}"
		bind:value={message}
		bind:this={inputElement}
		inputmode="search"
	/>
	<hr class="absolute inset-x-2 -top-px bg-slate-200 peer-focus:hidden" />

	<!-- Show HuntBot icon when chatbox is minimized -->
	{#if minimized}
		<img src={huntbotlogo} alt="HuntBot&apos;s Avatar" class="h-12 flex-none basis-12" />
	{/if}
</form>
