<script lang="ts">
	import Links from '$lib/nav/Links.svelte';

	import '../app.css';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import lettermark from '$lib/assets/lettermark.svg';
	import { send, receive } from '$lib/utilities/transition';

	let initialedChat = false;
</script>

<div
	class="fixed inset-x-0 mx-auto grid h-full w-full max-w-screen-2xl grid-cols-5 gap-4 px-2 sm:grid-cols-9 sm:px-16"
	class:z-40={initialedChat}
>
	<div class="relative col-span-3 flex w-full flex-col justify-stretch gap-4">
		<!-- This div covers the first vertical half of the nav bar -->
		<div class="flex-1">
			<div class="bg-stone-100 py-16">
				<img src={lettermark} alt="Hunters lettermark logo" />
			</div>
			{#if initialedChat}
				<div in:receive={{ key: 'links' }} out:send={{ key: 'links' }}>
					<Links />
				</div>
			{/if}
		</div>
		<!-- This div covers the second half content -->
		<div class="flex flex-1 flex-col justify-between">
			<div class="inline-flex w-full grow justify-between gap-4">
				{#if !initialedChat}
					<div
						class="inline-flex w-full grow justify-between gap-4"
						in:receive={{ key: 'huntbot' }}
						out:send={{ key: 'huntbot' }}
					>
						<h3 class="text-6xl font-bold tracking-tighter text-stone-800">How?</h3>
						<button
							class="h-12 rounded bg-blue-600 px-3 text-stone-50"
							on:click={() => {
								initialedChat = true;
							}}>Ask HuntBot</button
						>
					</div>
				{/if}
			</div>
			{#if !initialedChat}
				<div in:receive={{ key: 'links' }} out:send={{ key: 'links' }}>
					<Links />
				</div>
			{/if}
		</div>
		<!-- <ChatBox /> -->
		{#if initialedChat}
			<div
				in:receive={{ key: 'huntbot' }}
				out:send={{ key: 'huntbot' }}
				class="absolute bottom-0 w-full"
			>
				<ChatBox />
			</div>
		{/if}
	</div>
</div>
<slot />
