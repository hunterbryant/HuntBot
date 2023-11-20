<script type="ts">
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
	import { messages } from './MessageStore';
	import { afterUpdate } from 'svelte';

	let element;

	// Triggers upon messages updating
	$: if ($messages && element) {
		scrollToBottom(element);
	}

	// Once DOM has changed. Tbh I don't completely understand, but without it, the scrollable area never goes all the way to the bottom
	afterUpdate(() => {
		if ($messages) scrollToBottom(element);
	});

	const scrollToBottom = async (node) => {
		node.scroll({ top: node.scrollHeight, behavior: 'smooth' });
	};
</script>

<div
	class="flex-col-rev absolute bottom-2 left-2 right-2 flex max-h-[calc(100vh-1rem)] w-[calc(full-4rem)] flex-col flex-nowrap overflow-hidden rounded-3xl bg-white shadow-md sm:left-auto sm:max-h-[calc(100vh-2rem)] sm:w-[calc(27.5rem)]"
>
	<!-- This initial "message" acts as the header and original kickoff button -->
	<GreetingMessage />

	<!-- This is the scrollable zone -->
	<div class="overflow-scroll pb-4" bind:this={element}>
		{#each $messages as message, i}
			{#if message.type == 'user'}
				<UserMessage value={message.message} />
			{:else}
				<BotMessage value={message.message} />
			{/if}
		{/each}
	</div>

	<TextInput />
</div>
