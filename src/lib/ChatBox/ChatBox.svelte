<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import { messages } from './MessageStore';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import arrowdown from '$lib/assets/arrow-down.svg';
	import { setContext } from 'svelte';
	import { navEngaged, chatOpen } from '$lib/nav/navstore';

	let scrollElement: HTMLDivElement;
	let isScrolling = false;
	let scrolledToBottom = false;

	export let minimized = true;
	export let greeting: string = "Hi 👋, I'm HuntBot";

	// Check if scrolled to the bottom
	function checkScrolledDown() {
		scrolledToBottom =
			scrollElement.scrollTop === scrollElement.scrollHeight - scrollElement.offsetHeight;
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
				scrollElement.scroll({ top: scrollElement.scrollHeight, behavior: 'smooth' });
			}
		}
	};

	// Share the scroll function with child components
	setContext('scroll', { scrollToBottom });

	$: if (!$navEngaged) {
		minimized = true;
	}
</script>

<div
	class="flex-col-rev mb-4 flex max-h-full w-full flex-col flex-nowrap overflow-hidden rounded-lg border border-stone-200 bg-white sm:left-auto sm:max-h-[calc(100vh-2rem)]"
>
	<!-- This initial "message" acts as the header and original kickoff button -->
	{#if $messages.length == 0 || !minimized}
		<GreetingMessage bind:minimized bind:greeting />
	{/if}

	{#if !minimized}
		<!-- This is the scrollable zone -->
		<div
			class="relative overflow-scroll"
			bind:this={scrollElement}
			on:scroll={checkScrolledDown}
			transition:slide={{ duration: 300, easing: cubicOut }}
			on:introend={() => {
				scrollToBottom();
				chatOpen.set(true);
			}}
		>
			<!-- This is the scroll to bottom button -->
			{#if isScrolling && !scrolledToBottom}
				<div
					transition:fade
					class="sticky top-[calc(100%-6rem)] mx-0 block h-24 w-full bg-gradient-to-b from-transparent to-white"
				>
					<button
						on:click={() => {
							scrollToBottom();
						}}
						class="absolute bottom-2 left-1/2 mx-auto block h-8 w-8 -translate-x-1/2 rounded border border-stone-300 bg-stone-200 transition hover:bg-stone-300"
					>
						<img src={arrowdown} alt="Down arrow icon" class="m-auto flex-none" />
					</button>
				</div>
			{/if}
			<!-- Render the chat messages -->
			{#each $messages as message}
				<div
					class="first:pt-4 last:pb-6"
					in:slide={{ duration: 400 }}
					on:introend={() => {
						scrollToBottom();
					}}
				>
					{#if message.type == 'user'}
						<UserMessage value={message.message} />
					{:else}
						<BotMessage value={message.message} />
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if $messages.length != 0}
		<TextInput bind:minimized />
	{/if}
</div>
