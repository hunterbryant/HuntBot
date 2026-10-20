<svelte:options accessors />

<script lang="ts">
	import { slide, fly } from 'svelte/transition';
	import Check from '$lib/assets/check.svelte';
	import Close from '$lib/assets/close.svelte';
	import { FunctionState, type FunctionMessage } from '$lib/types';
	import { page } from '$app/stores';
	import { captureEvent } from '$lib/analytics';
	import { SESSION_ID } from './MessageStore.svelte';

	export let value: FunctionMessage;

	// Each button fades in after the one before it, once the card has slid open.
	const CARD_SLIDE_MS = 400;
	const CHIP_STAGGER_MS = 120;

	function trackContact(channel: 'email' | 'linkedin') {
		captureEvent('contact_clicked', SESSION_ID, {
			session_id: SESSION_ID,
			current_page: $page.url.pathname,
			channel
		});
	}
</script>

{#if value.name === 'capture_lead_intent'}
	<!-- Contact card under a hiring/collaboration reply: the conversion moment, so real buttons
	     in sentence case rather than the uppercase status pill the other actions use. -->
	<div
		in:slide|global={{ duration: CARD_SLIDE_MS }}
		class="mb-4 ml-14 mr-6 mt-2 flex flex-wrap gap-2"
	>
		<a
			in:fly|global={{ y: 8, duration: 200, delay: CARD_SLIDE_MS }}
			href="mailto:hunter.bryant2016@gmail.com"
			on:click={() => trackContact('email')}
			class="inline-flex h-10 items-center rounded bg-mud-600 px-3 pt-0.5 text-sm text-stone-50 transition hover:bg-mud-700 active:bg-mud-600 dark:bg-mud-500 dark:text-stone-950 dark:hover:bg-mud-600 dark:active:bg-mud-500"
		>
			Email Hunter
		</a>
		<a
			in:fly|global={{ y: 8, duration: 200, delay: CARD_SLIDE_MS + CHIP_STAGGER_MS }}
			href="https://www.linkedin.com/in/hunterbryant1/"
			target="_blank"
			rel="noopener noreferrer"
			on:click={() => trackContact('linkedin')}
			class="inline-flex h-10 items-center rounded border border-stone-200 px-3 pt-0.5 text-sm text-stone-600 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-900/40"
		>
			LinkedIn
		</a>
	</div>
{:else}
	<div
		in:slide|global={{ duration: 400 }}
		class="mb-4 ml-12 mr-6 mt-4 flex flex-col gap-1 rounded-2xl border border-stone-200 bg-stone-100 py-1 pl-3 pr-1.5 text-xs font-medium uppercase tracking-wider text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
	>
		<div class="flex flex-row items-center justify-between">
			<p class="my-1">{value.content}</p>

			{#if value.data === FunctionState.loading}
				<svg
					class="mt-0.5 inline-block h-5 w-5 animate-spin text-stone-400 dark:text-stone-500"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					width="24"
					height="24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
			{:else if value.data === FunctionState.success}
				<div class="-mr-0.5 text-emerald-400 dark:text-emerald-600">
					<Check />
				</div>
			{:else}
				<div class="-mr-0.5 text-red-400 dark:text-red-600">
					<Close />
				</div>
			{/if}
		</div>
	</div>
{/if}
