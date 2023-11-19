<script>
	import TextInput from './TextInput.svelte';
	import UserMessage from './UserMessage.svelte';
	import BotMessage from './BotMessage.svelte';
	import GreetingMessage from './GreetingMessage.svelte';
</script>

<div
	class="flex-col-rev absolute bottom-2 left-2 right-2 flex max-h-[calc(100vh-1rem)] w-[calc(full-4rem)] flex-col flex-nowrap overflow-hidden rounded-3xl bg-white shadow-md sm:left-auto sm:max-h-[calc(100vh-2rem)] sm:w-[calc(27.5rem)]"
>
	<!-- This initial "message" acts as the header and original kickoff button -->
	<GreetingMessage />

	<!-- This is the scrollable zone -->
	<div class="overflow-scroll pb-4">
		{#each Array(17) as _, i}
			<UserMessage />
			<BotMessage />
		{/each}
	</div>

	<TextInput />
</div>
