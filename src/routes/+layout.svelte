<script lang="ts">
	import '../app.css';

	import Links from '$lib/nav/Links.svelte';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import lettermark from '$lib/assets/lettermark.svg';
	import { navEngaged } from '$lib/nav/navstore';
	import { botEngaged, messages } from '$lib/ChatBox/MessageStore';

	import { send, receive } from '$lib/utilities/transition';
	import { slide } from 'svelte/transition';

	let minimized = true;
	let greeting = 'Any questions?';
	let hitButton = false;
	let greetingResponse =
		"I'm a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗";

	const engageHuntbot = () => {
		if (!$botEngaged) {
			hitButton = true;
			greeting = "Hi 👋, I'm HuntBot";
			navEngaged.set(true);
			window.scrollTo({
				top: window.innerHeight / 2 - 64,
				behavior: 'smooth'
			});
		} else {
			minimized = false;
			navEngaged.set(true);
			window.scrollTo({
				top: window.innerHeight / 2 - 64,
				behavior: 'smooth'
			});
		}
	};

	const animationFinished = () => {
		if (!$botEngaged && hitButton) {
			setTimeout(() => {
				// Insert blank value for loading state
				messages.update((m) => [...m, { type: 'bot', message: '' }]);

				botEngaged.set(true);
				minimized = false;

				setTimeout(() => {
					messages.update((m) => {
						m[m.length - 1] = { type: 'bot', message: greetingResponse };
						return m;
					});
				}, 600);
			}, 100);
		}
	};
</script>

<div
	class="fixed inset-x-0 mx-auto grid h-full w-full max-w-screen-2xl grid-cols-5 gap-4 px-2 sm:grid-cols-9 sm:px-16"
	class:z-40={$navEngaged}
>
	<div class="relative col-span-3 flex h-screen w-full flex-col justify-stretch gap-4">
		<!-- This div covers the first vertical half of the nav bar -->
		<div class=" min-h-0 flex-1">
			<div class=" bg-stone-100 py-16">
				<img class="inline-block" src={lettermark} alt="Hunters lettermark logo" />
			</div>
			{#if $navEngaged}
				<div in:receive={{ key: 'links' }} out:send={{ key: 'links' }}>
					<Links />
				</div>
			{/if}
		</div>
		<!-- This div covers the second half content -->
		<div class="flex min-h-0 flex-1 flex-col justify-between" transition:slide>
			{#if !$navEngaged}
				<div
					class="col-span-1 col-start-1 row-span-1 row-start-1 flex h-12 w-full justify-between gap-4"
					in:receive={{ key: 'huntbot' }}
					out:send={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized = true;
					}}
				>
					<h3 class="text-5xl font-bold tracking-tighter text-stone-800 xl:text-6xl">How?</h3>
					<button
						class="h-12 rounded bg-blue-600 px-3 text-stone-50 hover:bg-blue-700 active:bg-blue-600"
						on:click={engageHuntbot}>Ask HuntBot</button
					>
				</div>

				<div class="grid grid-cols-1">
					<div in:receive={{ key: 'links' }} out:send={{ key: 'links' }}>
						<Links />
					</div>
				</div>
			{:else}
				<div
					in:receive={{ key: 'huntbot' }}
					out:send={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized = true;
					}}
					on:introend={() => {
						animationFinished();
						if ($messages.length > 0) {
							minimized = false;
						}
					}}
					on:outrostart={() => {
						minimized = true;
					}}
					class="absolute bottom-0 w-full"
				>
					<ChatBox bind:minimized bind:greeting />
				</div>
			{/if}
		</div>
	</div>
</div>
<slot />
