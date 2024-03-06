<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import arrowdown from '$lib/assets/arrow-down.svg';
	import { navEngaged, chatOpen } from '$lib/nav/navstore';
	import Beaker from '$lib/assets/beaker.svelte';
	import ActionMessage from './ActionMessage.svelte';
	import { chat, botEngaged, minimized } from './MessageStore';
	import { onMount } from 'svelte';
	import { crawlDocument } from '$lib/utilities/setupContext';
	import { urls } from '$lib/utilities/urls';

	const { messages } = chat();

	let scrollElement: HTMLDivElement;
	let isScrolling = false;
	let scrolledToBottom = false;

	export let greeting: string = "Hi 👋, I'm HuntBot";

	// Check if scrolled to the bottom
	function checkScrolledDown() {
		scrolledToBottom =
			scrollElement.scrollTop >= scrollElement.scrollHeight - scrollElement.offsetHeight - 40;
	}

	// Check if scrolling is active
	$: if (scrollElement && $messages.length > 2) {
		isScrolling = scrollElement.scrollHeight > scrollElement.clientHeight;
	}

	//Scroll to the bottom
	const scrollToBottom = async () => {
		if (scrollElement) {
			// Check to see if the scroll is active
			if (scrollElement.scrollHeight > scrollElement.clientHeight) {
				scrollElement.scroll({ top: scrollElement.scrollHeight + 10, behavior: 'smooth' });
			}
		}
	};

	messages.subscribe(() => {
		scrollToBottom();
		setTimeout(() => {
			scrollToBottom();
		}, 400);
	});

	$: if (!$navEngaged) {
		minimized.set(true);
	}
</script>

<div
	class="flex-col-rev z-50 mb-0 flex max-h-[calc(100dvh-4.5rem)] w-full flex-col flex-nowrap overflow-hidden rounded-t-lg border-t border-stone-200 bg-white sm:left-auto sm:mb-4 sm:max-h-[calc(100dvh-2rem)] sm:rounded-lg sm:border dark:border-stone-800 dark:bg-black"
>
	<!-- This initial "message" acts as the header and original kickoff button -->
	{#if !$botEngaged || !$minimized}
		<GreetingMessage bind:greeting />
	{/if}

	{#if !$minimized}
		<!-- This is the scrollable zone -->
		<div
			class="relative overflow-scroll"
			bind:this={scrollElement}
			on:scroll={checkScrolledDown}
			transition:slide|global={{ duration: 300, easing: cubicOut }}
			on:introend={() => {
				scrollToBottom();
				setTimeout(() => {
					scrollToBottom();
				}, 400);
			}}
		>
			<!-- This is the scroll to bottom button -->
			{#if isScrolling && !scrolledToBottom}
				<div
					transition:fade|global
					class="sticky top-[calc(100%-6rem)] mx-0 -mt-20 block h-24 w-full bg-gradient-to-b from-transparent to-white dark:to-black"
				>
					<button
						on:click={() => {
							scrollToBottom();
						}}
						class="dark:hover:ng-stone-700 absolute bottom-2 left-1/2 mx-auto block h-8 w-8 -translate-x-1/2 rounded border border-stone-300 bg-stone-200 transition hover:bg-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700"
					>
						<img src={arrowdown} alt="Down arrow icon" class="m-auto flex-none dark:invert" />
					</button>
				</div>
			{/if}
			<!-- Render the chat messages -->
			<div class="first:pt-4 last:pb-6">
				<div
					class="mx-2 -mt-2 mb-2 rounded border border-yellow-400 bg-yellow-200 px-3 py-2 text-xs dark:border-yellow-600 dark:bg-yellow-800"
				>
					<h6
						class="mb-2 mt-1 flex items-center gap-x-2 font-bold uppercase tracking-wider text-yellow-800 dark:text-yellow-200"
					>
						<Beaker /> In Development
					</h6>
					<p class=" mb-1 text-sm leading-tight text-yellow-700 dark:text-yellow-300">
						HuntBot is being rewritten for speed, accuracy, and functionality. Take anything he says
						with a grain of salt.
					</p>
				</div>
				{#each $messages as message}
					<div
						in:slide|global={{ duration: 400 }}
						on:introend={() => {
							scrollToBottom();
							setTimeout(() => {
								scrollToBottom();
							}, 400);
						}}
					>
						{#if message.role === 'user'}
							<UserMessage value={message.content} />
						{:else if message.role === 'assistant' && message.content}
							<BotMessage value={message.content} />
						{:else if message.role === 'function'}
							<ActionMessage value={message} />
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
	{#if $botEngaged}
		<TextInput />
	{/if}
</div>
