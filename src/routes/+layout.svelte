<script lang="ts">
	import '../app.css';
	import { dev } from '$app/environment';

	import { inject } from '@vercel/analytics';
	import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
	import Lettermark from '$lib/assets/lettermark.svelte';

	import Links from '$lib/nav/Links.svelte';
	import ChatBox from '$lib/ChatBox/ChatBox.svelte';
	import { navEngaged, delayedNavEngaged, mobile, chatOpen } from '$lib/nav/navstore';
	import { botEngaged, chat, minimized } from '$lib/ChatBox/MessageStore';

	import { send, receive } from '$lib/utilities/transition';
	import { fly, slide } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';

	inject({ mode: dev ? 'development' : 'production' });
	injectSpeedInsights();

	export let data;

	let greeting = 'Any questions?';
	let hitButton = false;
	let menuActive = false;
	let mobileBreakpoint = false;
	let innerWidth: number;
	let slotElement: HTMLElement;
	let mounted = false;

	// On initial load set nav state based on entry path,
	// must not live within onMount
	if ($page.url.pathname === '/') {
		// Reset nav state on index
		navEngaged.set(false);
	} else {
		// Return to default on all others
		navEngaged.set(true);
	}

	const engageHuntbot = () => {
		const scrollDistance = mobileBreakpoint ? window.innerHeight / 2 : window.innerHeight / 2 - 64;
		if (!$botEngaged) {
			hitButton = true;
			greeting = "Hi 👋, I'm HuntBot";
		} else {
			minimized.set(false);
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

				botEngaged.set(true);
				minimized.set(false);
				chatOpen.set(true);
			}, 100);
		}
		if ($chatOpen) {
			minimized.set(false);
		}
	};

	onMount(() => {
		if (innerWidth <= 640) {
			mobileBreakpoint = true;
			mobile.set(true);
		}
		mounted = true;
	});

	// Change the nav state based on destination path
	beforeNavigate((navData) => {
		// Don't rerun state animations if doing a hard refresh
		if (!navData.willUnload) {
			if (navData.to?.route.id === '/') {
				// Reset nav state on index
				navEngaged.set(false);
				closeMenu();
			} else if (navData.to?.route.id !== null) {
				// Return to engaged if routing within the site
				navEngaged.set(true);
				closeMenu();
			}
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
				class="pointer-events-auto z-40 -mx-2 flex justify-between bg-stone-100 px-2 pb-4 pt-4 text-stone-800 *:flex *:h-11 *:items-center sm:z-30 sm:-ml-4 sm:-mr-4 sm:pb-8 sm:pl-4 sm:pr-4 sm:pt-10 dark:bg-stone-900 dark:text-stone-200"
			>
				<a
					href={$page.url.pathname === '/' ? null : '/'}
					class="rounded px-0 transition-all {$page.url.pathname === '/'
						? 'hover:bg-none hover:px-0'
						: 'hover:bg-stone-200 hover:px-2 dark:hover:bg-stone-800'}"
					data-sveltekit-noscroll
				>
					<Lettermark />
				</a>
				<button
					class="rounded bg-stone-200 px-2 text-xs font-bold uppercase tracking-wider text-stone-900 transition-all hover:bg-stone-300 sm:hidden dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700"
					on:click={menuActive ? closeMenu : openMenu}
				>
					{menuActive ? 'Close' : 'Menu'}
				</button>
			</div>
			{#if menuActive || !mobileBreakpoint}
				<div class=" flex grow flex-col" transition:fly={{ x: -350 }}>
					{#if ($delayedNavEngaged || mobileBreakpoint) && mounted}
						<!-- This is the toggleable section in mobile breakpoints -->
						<div
							class=" -mx-2 grid grow grid-cols-1 bg-stone-100 px-2 sm:grow-0 sm:bg-transparent dark:bg-stone-900 sm:dark:bg-transparent"
						>
							<div
								in:receive|global={{ key: 'links' }}
								out:send|global={{ key: 'links' }}
								class="mx-auto flex w-full max-w-80 flex-col justify-between pt-4 sm:max-w-none sm:pt-0"
							>
								<Links />
							</div>
						</div>
						<div
							class="pointer-events-auto z-40 flex justify-end bg-stone-100 pb-4 pt-4 sm:z-30 sm:hidden sm:py-16 dark:bg-stone-900"
						>
							<button
								class="h-11 rounded bg-stone-200 px-2 text-xs font-bold uppercase tracking-wider text-stone-900 transition hover:bg-stone-300 sm:hidden dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700"
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
			transition:slide|global
		>
			{#if !$delayedNavEngaged}
				<div
					class="pointer-events-auto col-span-1 col-start-1 row-span-1 row-start-1 mb-2 flex h-12 w-full justify-between gap-4 sm:mb-0"
					in:receive|global={{ key: 'huntbot' }}
					out:send|global={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized.set(true);
					}}
				>
					<h3
						class="text-5xl font-bold tracking-tighter text-stone-800 xl:text-6xl dark:text-stone-200"
					>
						How?
					</h3>
					<button
						class="h-12 rounded bg-blue-600 px-3 pt-0.5 text-stone-50 transition hover:bg-blue-700 active:bg-blue-600 dark:bg-blue-500 dark:text-stone-950 dark:hover:bg-blue-600 dark:active:bg-blue-500"
						on:click={engageHuntbot}>Ask HuntBot</button
					>
				</div>

				<div class="hidden grow grid-cols-1 sm:grid sm:grow-0">
					<div
						in:receive|global={{ key: 'links' }}
						out:send|global={{ key: 'links' }}
						class="pointer-events-auto mx-auto -mb-8 flex w-full max-w-80 flex-col justify-between pt-16 sm:max-w-none sm:pt-0"
					>
						<Links />
					</div>
				</div>
			{:else if !mobileBreakpoint}
				<div
					in:receive|global={{ key: 'huntbot' }}
					out:send|global={{ key: 'huntbot' }}
					on:introstart={() => {
						minimized.set(true);
					}}
					on:introend={() => {
						animationFinished();
					}}
					on:outrostart={() => {
						minimized.set(true);
					}}
					on:outroend={() => {
						minimized.set(true);
					}}
					class="pointer-events-auto absolute bottom-0 z-50 -mx-2 w-full flex-initial sm:mx-0"
				>
					<ChatBox bind:greeting />
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Fixed chatbot div in mobile breakpoints -->
{#if mobileBreakpoint && $delayedNavEngaged}
	<div
		in:receive|global={{ key: 'huntbot' }}
		out:send|global={{ key: 'huntbot' }}
		on:introstart={() => {
			minimized.set(true);
		}}
		on:introend={() => {
			animationFinished();
		}}
		on:outrostart={() => {
			minimized.set(true);
		}}
		on:outroend={() => {
			minimized.set(true);
		}}
		class="fixed bottom-0 z-50 -mx-0 w-full flex-initial sm:mx-0"
	>
		<ChatBox bind:greeting />
	</div>
{/if}

<!-- The slot is nested in a key to detect page changes, causing a page transition -->
<!-- Look into using the View Transition API as it gains browser support -->
<div bind:this={slotElement}>
	{#key data.pathname}
		<div
			in:fly|global={{ x: 100, duration: 200, delay: 200 }}
			out:fly|global={{ x: -100, duration: 200 }}
			class="overflow-x-hidden"
		>
			<slot />
		</div>
	{/key}
</div>
