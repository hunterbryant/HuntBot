<script lang="ts">
	import '../app.css';

	import Links from '$lib/nav/Links.svelte';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import lettermark from '$lib/assets/lettermark.svg';
	import { navEngaged, delayedNavEngaged, mobile, chatOpen } from '$lib/nav/navstore';
	import { botEngaged, messages } from '$lib/ChatBox/MessageStore';

	import { send, receive } from '$lib/utilities/transition';
	import { fly, slide } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';

	export let data;

	let minimized = true;
	let greeting = 'Any questions?';
	let hitButton = false;
	let greetingResponse =
		"I'm a Frankenstein project Hunter hacked together to pitch himself. I’m wired into his site.\nIf you’re game, ask me a question. You could ask about his work, design philosophy, or about life.\nIf you don’t want to play along, you can minimize me up to your right↗";
	let menuActive = false;
	let mobileBreakpoint = true;
	let innerWidth = 0;
	let slotElement: HTMLElement;

	const engageHuntbot = () => {
		const scrollDistance = mobileBreakpoint ? window.innerHeight / 2 : window.innerHeight / 2 - 64;
		if (!$botEngaged) {
			hitButton = true;
			greeting = "Hi 👋, I'm HuntBot";
		} else {
			minimized = false;
		}
		window.scrollTo({
			top: scrollDistance,
			behavior: 'smooth'
		});
		navEngaged.set(true);
	};

	const animationFinished = () => {
		if (!$botEngaged && hitButton) {
			setTimeout(() => {
				// Insert blank value for loading state
				messages.update((m) => [...m, { type: 'bot', message: '' }]);

				botEngaged.set(true);
				minimized = false;
				chatOpen.set(true);

				setTimeout(() => {
					messages.update((m) => {
						m[m.length - 1] = { type: 'bot', message: greetingResponse };
						return m;
					});
				}, 600);
			}, 100);
		}
		if ($chatOpen) {
			minimized = false;
		}
	};

	onMount(() => {
		if (innerWidth > 640) {
			menuActive = true;
			mobileBreakpoint = false;
			mobile.set(false);
		} else {
			menuActive = false;
			mobileBreakpoint = true;
			mobile.set(true);
		}
	});

	// On initial load set nav state based on entry path
	if ($page.url.pathname == '/') {
		// Reset nav state on index
		navEngaged.set(false);
	} else {
		// Return to default on all others
		navEngaged.set(true);
	}

	// Change the nav state based on destination path
	beforeNavigate((navData) => {
		if (navData.to?.route.id === '/') {
			// Reset nav state on index
			navEngaged.set(false);
			closeMenu();
		} else if (navData.to?.route.id !== undefined) {
			// Return to engaged if routing within the site
			navEngaged.set(true);
			closeMenu();
		}
	});

	afterNavigate(() => {
		window.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
	});

	// Halt window scrolling when mobile menu is active
	const openMenu = () => {
		menuActive = true;
		if (mobileBreakpoint) {
			const scrollY = window.scrollY;
			slotElement.style.position = 'fixed';
			slotElement.style.top = `-${scrollY}px`;
		}
	};

	const closeMenu = () => {
		if (mobileBreakpoint) {
			const scrollY = slotElement.style.top;
			slotElement.style.position = '';
			slotElement.style.top = '';
			window.scrollTo(0, parseInt(scrollY || '0') * -1);
		}
		menuActive = false;
	};
</script>

<svelte:head>
	<meta property="interactive-widget" content="resizes-content" />
	<meta property="og:site_name" content="Hunter Bryant" />
</svelte:head>

<svelte:window bind:innerWidth />

<div
	class="pointer-events-none fixed inset-x-0 z-40 mx-auto grid h-full w-full grid-cols-5 gap-2 px-2 sm:max-w-screen-xl sm:grid-cols-6 sm:gap-4 sm:bg-transparent sm:px-8 md:grid-cols-7 lg:grid-cols-9 lg:px-16"
>
	<div
		class="col-span-5 flex h-dvh w-full flex-col justify-stretch {$delayedNavEngaged
			? 'gap-4'
			: 'gap-0'} sm:relative sm:col-span-3 sm:gap-4"
	>
		<!-- This div covers the first vertical half of the nav bar -->
		<div class=" flex min-h-0 flex-grow flex-col sm:flex-1">
			<!-- This is the navbar -->
			<div
				class="pointer-events-auto z-40 -mx-2 flex justify-between bg-stone-100 px-2 pb-4 pt-4 *:flex *:h-11 *:items-center sm:z-30 sm:-ml-4 sm:-mr-4 sm:pb-8 sm:pl-4 sm:pr-4 sm:pt-10"
			>
				<a
					href={$page.url.pathname === '/' ? null : '/'}
					class="px-0 transition-all hover:rounded hover:bg-stone-200 hover:px-2"
					data-sveltekit-noscroll
					><img class="inline-block" src={lettermark} alt="Hunters lettermark logo" /></a
				>
				<button
					class="rounded bg-stone-200 px-2 text-xs font-bold uppercase tracking-wider text-stone-900 transition-all hover:bg-stone-300 sm:hidden"
					on:click={menuActive ? closeMenu : openMenu}
				>
					{menuActive ? 'Close' : 'Menu'}
				</button>
			</div>
			{#if menuActive || !mobileBreakpoint}
				<div class=" flex grow flex-col" transition:fly={{ x: -350 }}>
					{#if $delayedNavEngaged || mobileBreakpoint}
						<!-- This is the toggleable section in mobile breakpoints -->
						<div
							class="pointer-events-auto -mx-2 grid grow grid-cols-1 bg-stone-100 px-2 sm:grow-0 sm:bg-transparent"
						>
							<div
								in:receive={{ key: 'links' }}
								out:send={{ key: 'links' }}
								class="mx-auto flex w-full max-w-80 flex-col justify-between pt-4 sm:max-w-none sm:pt-0"
							>
								<Links />
							</div>
						</div>
						<div class="z-40 flex justify-end bg-stone-100 pb-4 pt-4 sm:z-30 sm:hidden sm:py-16">
							<button
								class="h-11 rounded bg-stone-200 px-2 text-xs font-bold uppercase tracking-wider text-stone-900 transition hover:bg-stone-300 sm:hidden"
								on:click={menuActive ? closeMenu : openMenu}
							>
								{menuActive ? 'Close' : 'Menu'}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
		<!-- This div covers the second half content -->
		<div
			class="flex {$delayedNavEngaged
				? 'min-h-10'
				: 'min-h-0'} pointer-events-none flex-initial flex-col justify-between sm:flex-1"
			transition:slide
		>
			{#if !$delayedNavEngaged}
				<div
					class="pointer-events-auto col-span-1 col-start-1 row-span-1 row-start-1 mb-2 flex h-12 w-full justify-between gap-4 sm:mb-0"
					in:receive={{ key: 'huntbot' }}
					out:send={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized = true;
					}}
				>
					<h3 class="text-5xl font-bold tracking-tighter text-stone-800 xl:text-6xl">How?</h3>
					<button
						class="h-12 rounded bg-blue-600 px-3 text-stone-50 transition hover:bg-blue-700 active:bg-blue-600"
						on:click={engageHuntbot}>Ask HuntBot</button
					>
				</div>

				<div class="hidden grow grid-cols-1 sm:grid sm:grow-0">
					<div
						in:receive={{ key: 'links' }}
						out:send={{ key: 'links' }}
						class="pointer-events-auto mx-auto -mb-8 flex w-full max-w-80 flex-col justify-between pt-16 sm:max-w-none sm:pt-0"
					>
						<Links />
					</div>
				</div>
			{:else if !mobileBreakpoint}
				<div
					in:receive={{ key: 'huntbot' }}
					out:send={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized = true;
					}}
					on:introend={() => {
						animationFinished();
					}}
					on:outrostart={() => {
						minimized = true;
					}}
					on:outroend={() => {
						minimized = true;
					}}
					class="pointer-events-auto absolute bottom-0 z-50 -mx-2 w-full flex-initial sm:mx-0"
				>
					<ChatBox bind:minimized bind:greeting />
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Fixed chatbot div in mobile breakpoints -->
{#if mobileBreakpoint && $delayedNavEngaged}
	<div
		in:receive={{ key: 'huntbot' }}
		out:send={{ key: 'huntbot' }}
		on:introstart={() => {
			minimized = true;
		}}
		on:introend={() => {
			animationFinished();
		}}
		on:outrostart={() => {
			minimized = true;
		}}
		on:outroend={() => {
			minimized = true;
		}}
		class="fixed bottom-0 z-50 -mx-0 w-full flex-initial sm:mx-0"
	>
		<ChatBox bind:minimized bind:greeting />
	</div>
{/if}

<!-- The slot is nested in a key to detect page changes, causing a page transition -->
<!-- Look into using the View Transition API as it gains browser support -->
<div bind:this={slotElement}>
	{#key data.pathname}
		<div
			in:fly={{ x: 100, duration: 200, delay: 200 }}
			out:fly={{ x: -100, duration: 200 }}
			class="overflow-x-hidden"
		>
			<slot />
		</div>
	{/key}
</div>
