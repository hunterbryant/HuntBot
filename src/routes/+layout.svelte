<script lang="ts">
	import '../app.css';

	import Links from '$lib/nav/Links.svelte';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import lettermark from '$lib/assets/lettermark.svg';
	import { navEngaged, delayedNavEngaged, chatOpen } from '$lib/nav/navstore';
	import { botEngaged, messages } from '$lib/ChatBox/MessageStore';

	import { send, receive } from '$lib/utilities/transition';
	import { slide } from 'svelte/transition';

	let minimized = true;
	let greeting = 'Any questions?';
	let hitButton = false;
	let greetingResponse =
		"I'm a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗";
	let menuActive = false;

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
	class="fixed inset-x-0 mx-auto grid h-full w-full max-w-screen-xl grid-cols-5 gap-2 px-2 sm:grid-cols-6 sm:gap-4 sm:px-8 md:grid-cols-7 lg:grid-cols-9 lg:px-16 bg-stone-100 sm:bg-transparent z-40"
>
	<div
		class="flex sm:relative col-span-5 h-screen w-full flex-col justify-stretch gap-4 sm:col-span-3"
	>
		<!-- This div covers the first vertical half of the nav bar -->
		<div class=" min-h-0 flex-grow sm:flex-1 flex flex-col">
			<div class="z-40 sm:z-30 flex justify-between bg-stone-100 pb-4 pt-11 sm:py-16">
				<a href="/"><img class="inline-block" src={lettermark} alt="Hunters lettermark logo" /></a>
				<button
					class="rounded bg-stone-200 p-1 text-xs font-bold uppercase tracking-wider text-stone-900 transition hover:bg-stone-300 sm:hidden"
					on:click={() => (menuActive = !menuActive)}
				>
					{menuActive ? 'Close' : 'Menu'}
				</button>
			</div>
			{#if $delayedNavEngaged}
				<div class="grid grow grid-cols-1 sm:grow-0">
					<div
						in:receive={{ key: 'links' }}
						out:send={{ key: 'links' }}
						class="sm:pt-0 flex flex-col justify-between pt-16 max-w-80 w-full sm:max-w-none mx-auto"
					>
						<Links />
					</div>
				</div>
				<div class="z-40 sm:z-30 flex justify-end bg-stone-100 pt-16  pb-4 sm:hidden sm:py-16">
					<button
						class="rounded bg-stone-200 p-1 text-xs font-bold uppercase tracking-wider text-stone-900 transition hover:bg-stone-300 sm:hidden"
						on:click={() => (menuActive = !menuActive)}
					>
						{menuActive ? 'Close' : 'Menu'}
					</button>
				</div>
			{/if}
		</div>
		<!-- This div covers the second half content -->
		<div class="flex min-h-16 flex-initial sm:flex-1 flex-col justify-between " transition:slide>
			{#if !$delayedNavEngaged}
				<div
					class="col-span-1 col-start-1 row-span-1 row-start-1 hidden h-12 w-full justify-between gap-4 sm:flex"
					in:receive={{ key: 'huntbot' }}
					out:send={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized = true;
						chatOpen.set(false);
					}}
				>
					<h3 class="text-5xl font-bold tracking-tighter text-stone-800 xl:text-6xl">How?</h3>
					<button
						class="h-12 rounded bg-blue-600 px-3 text-stone-50 hover:bg-blue-700 active:bg-blue-600"
						on:click={engageHuntbot}>Ask HuntBot</button
					>
				</div>

				<div class="hidden sm:grid grow grid-cols-1 sm:grow-0 ">
					<div
						in:receive={{ key: 'links' }}
						out:send={{ key: 'links' }}
						class="sm:pt-0 flex flex-col justify-between pt-16 max-w-80 w-full sm:max-w-none mx-auto"
					>
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
					on:outroend={() => {
						minimized = true;
					}}
					class="absolute bottom-0 w-full flex-initial z-50"
				>
					<ChatBox bind:minimized bind:greeting />
				</div>
				
			{/if}
			
		</div>
	</div>
</div>
<slot />
