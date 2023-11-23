<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import { messages } from './MessageStore';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import arrowdown from '$lib/assets/arrow-down.svg';

	let scrollElement: HTMLDivElement;
	let minimized = true;
	let isScrolling = false;
	let scrolledToBottom = false;

	// Check if scrolling
	$: if (scrollElement && $messages.length > 2) {
		isScrolling = scrollElement.scrollHeight > scrollElement.clientHeight;
	}

	function checkScroll() {
		scrolledToBottom =
			scrollElement.scrollTop === scrollElement.scrollHeight - scrollElement.offsetHeight;
	}

	const scrollToBottom = async (node: HTMLDivElement) => {
		// Check to see if the scroll is active
		if (node.scrollHeight > node.clientHeight) {
			node.scroll({ top: node.scrollHeight, behavior: 'smooth' });
		}
	};
</script>

<div
	class="flex-col-rev absolute bottom-2 left-2 right-2 flex max-h-[calc(100vh-1rem)] w-[calc(full-4rem)] flex-col flex-nowrap overflow-hidden rounded-3xl bg-white shadow-md sm:left-auto sm:max-h-[calc(100vh-2rem)] sm:w-[calc(27.5rem)]"
>
	<!-- This initial "message" acts as the header and original kickoff button -->
	{#if $messages.length == 0 || !minimized}
		<GreetingMessage bind:minimized />
	{/if}

	{#if !minimized}
		<!-- This is the scrollable zone -->
		<div
			class="relative overflow-scroll py-2"
			bind:this={scrollElement}
			on:scroll={checkScroll}
			transition:slide={{ duration: 300, easing: cubicOut }}
		>
			{#if isScrolling && !scrolledToBottom}
				<button
					on:click={scrollToBottom(scrollElement)}
					transition:fade
					class="sticky top-[calc(100%-2rem)] mx-auto block h-8 w-8 rounded-full bg-slate-100/50 backdrop-blur transition hover:bg-slate-300/50"
				>
					<img src={arrowdown} alt="Down arrow icon" class="m-auto flex-none" />
				</button>
			{/if}
			{#each $messages as message, i}
				<div
					in:slide={{ duration: isScrolling ? 0 : 400 }}
					on:introend={() => {
						scrollToBottom(scrollElement);
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
