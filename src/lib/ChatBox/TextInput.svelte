<script lang="ts">
	import arrowup from '$lib/assets/arrow-up.svg';
	import caretdown from '$lib/assets/caret-down.svg';
	import { chatOpen, mobile } from '$lib/nav/navstore';
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { chat, minimized } from './MessageStore';

	export let { input, handleSubmit, isLoading } = chat();

	let inputElement: HTMLInputElement;
	let placeholder = 'Message HuntBot';

	$: if ($minimized) {
		placeholder = 'If you need me... ask away!';
	}

	async function handleLocalSubmit(event: SubmitEvent) {
		// Clear the message after sending
		minimized.set(false);

		// Dismiss mobile keyboard
		if ($mobile) {
			inputElement.blur();
		}

		handleSubmit(event);
	}

	function focusInput() {
		if (inputElement) {
			inputElement.focus(); // Focus the input element
			placeholder = 'Message HuntBot';
		}
	}
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions-->
<form
	on:submit|preventDefault={handleLocalSubmit}
	on:click={focusInput}
	on:keydown={focusInput}
	class="relative flex w-[calc(full-4rem)] shrink-0 basis-12 cursor-text flex-row-reverse flex-nowrap items-center gap-1 overflow-visible rounded-md p-1 text-stone-800 outline-2 -outline-offset-2 focus-within:outline focus-within:outline-blue-200 dark:text-stone-200 dark:focus-within:outline-blue-800"
>
	{#if $input.trim() === '' && $minimized}
		<button
			on:click={() => {
				minimized.set(false);
				chatOpen.set(true);
			}}
			class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-slate-200 active:shadow-none dark:bg-black dark:hover:bg-stone-900 dark:active:bg-slate-800"
		>
			<img src={caretdown} alt="Caret down icon" class="m-auto flex-none -scale-y-100" />
		</button>
	{:else}
		<button
			type="submit"
			class="peer aspect-square h-12 basis-12 rounded bg-blue-600 transition hover:bg-blue-700 active:bg-blue-600 disabled:bg-blue-200 dark:bg-blue-500 dark:hover:bg-blue-600 dark:active:bg-blue-500 dark:disabled:bg-blue-900"
			disabled={$input.trim() === '' || $isLoading}
		>
			<img src={arrowup} alt="Up arrow icon" class="m-auto flex-none dark:invert" />
		</button>
	{/if}

	<input
		{placeholder}
		class="peer min-w-0 grow bg-transparent focus:outline-none {$minimized ? 'ml-0' : 'mx-2'}"
		bind:value={$input}
		bind:this={inputElement}
		inputmode="search"
	/>
	<hr class="absolute inset-x-2 -top-px border-slate-200 peer-focus:hidden dark:border-slate-800" />

	<!-- Show HuntBot icon when chatbox is minimized -->
	{#if $minimized}
		<Huntbotlogo />
	{/if}
</form>
