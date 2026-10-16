<script lang="ts">
	import arrowup from '$lib/assets/arrow-up.svg';
	import caretdown from '$lib/assets/caret-down.svg';
	import { mobile, keyboardOpen } from '$lib/nav/navstore';
	import Huntbotlogo from '$lib/assets/huntbotlogo.svelte';
	import { minimized, openChat } from './MessageStore.svelte';
	import type { Writable, Readable } from 'svelte/store';

	export let input: Writable<string>;
	export let handleSubmit: (e: SubmitEvent, options?: Record<string, unknown>) => void;
	export let isLoading: Readable<boolean>;
	export let currentPage: string = '/';

	let inputElement: HTMLInputElement;

	// A plain placeholder. Suggested questions live in the open chat's chip row, so tapping the
	// field only ever means "let me type" (it used to send whatever question was showing).
	$: placeholder = $minimized ? 'Ask about Hunter’s work…' : 'Message HuntBot';

	function handleLocalSubmit(event: SubmitEvent) {
		openChat('typed');

		if ($mobile) {
			inputElement.blur();
		}

		handleSubmit(event, { body: { currentPage } });
	}

	// Anywhere on the bar puts the cursor in the field, except its button
	function focusInput(event: MouseEvent) {
		if ((event.target as HTMLElement).closest('button')) return;
		inputElement?.focus();
	}
</script>

<!-- Clicking the bar is a convenience for pointer users; the input itself is the keyboard target. -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<form
	on:submit|preventDefault={handleLocalSubmit}
	on:click={focusInput}
	class="relative flex w-[calc(full-4rem)] shrink-0 basis-12 cursor-text flex-row-reverse flex-nowrap items-center gap-1 overflow-visible rounded-md p-1 text-stone-600 outline-2 -outline-offset-2 focus-within:outline focus-within:outline-mud-200 dark:text-stone-400 dark:focus-within:outline-mud-800"
>
	{#if $input.trim() === '' && $minimized}
		<button
			type="button"
			aria-label="Open chat"
			on:click={() => openChat('bar')}
			class="peer h-12 basis-12 rounded bg-white transition hover:bg-stone-100 active:bg-stone-200 active:shadow-none dark:bg-black dark:hover:bg-stone-900 dark:active:bg-stone-800"
		>
			<img src={caretdown} alt="" class="m-auto flex-none -scale-y-100" />
		</button>
	{:else}
		<button
			type="submit"
			aria-label="Send message"
			class="peer aspect-square h-12 basis-12 rounded bg-mud-600 transition hover:bg-mud-700 active:bg-mud-600 disabled:bg-mud-200 dark:bg-mud-500 dark:hover:bg-mud-600 dark:active:bg-mud-500 dark:disabled:bg-mud-900"
			disabled={$input.trim() === '' || $isLoading}
		>
			<img src={arrowup} alt="" class="m-auto flex-none dark:invert" />
		</button>
	{/if}

	<div class="relative min-w-0 grow {$minimized ? 'ml-0' : 'mx-2'}">
		<input
			aria-label="Message HuntBot"
			{placeholder}
			class="peer w-full bg-transparent text-stone-600 placeholder:text-stone-400 focus:outline-none dark:text-stone-400 dark:placeholder:text-stone-500"
			bind:value={$input}
			bind:this={inputElement}
			inputmode="search"
			enterkeyhint="send"
			on:focus={() => {
				if ($mobile) keyboardOpen.set(true);
			}}
			on:blur={() => keyboardOpen.set(false)}
		/>
	</div>
	<hr class="absolute inset-x-2 -top-px border-stone-200 peer-focus:hidden dark:border-stone-700" />

	{#if $minimized}
		<!-- Sketchy at rest, thinking while a reply is on its way. -->
		<Huntbotlogo mode={$isLoading ? 'thinking' : 'sketchy'} />
	{/if}
</form>
