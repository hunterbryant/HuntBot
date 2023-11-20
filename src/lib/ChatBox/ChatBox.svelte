<script lang="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import { messages } from './MessageStore';
	import { afterUpdate } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let scrollElement: HTMLDivElement;
	let minimized = true;

	// Triggers upon messages updating
	$: if ($messages && scrollElement) {
		scrollToBottom(scrollElement);
	}

	// Once DOM has changed. Tbh I don't completely understand, but without it, the scrollable area never goes all the way to the bottom
	afterUpdate(() => {
		if ($messages && scrollElement) scrollToBottom(scrollElement);
	});

	const scrollToBottom = async (node: HTMLDivElement) => {
		node.scroll({ top: node.scrollHeight, behavior: 'smooth' });
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
			class="overflow-scroll py-2"
			bind:this={scrollElement}
			transition:slide={{ duration: 300, easing: cubicOut }}
		>
			{#each $messages as message, i}
				<div in:slide>
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
