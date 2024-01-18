<script lang="ts">
	import lockClosed from '$lib/assets/lock-closed.svg';
	import type { ActionData } from './$types';
	import { enhance } from '$app/forms';

	export let form: ActionData;
</script>

<svelte:head>
	<title>Protected Page</title>
	<meta name="description" content="Enter the password to access Hunter's protected case studies" />
	<meta property="og:title" content="Enter Password – Hunter Bryant" />
	<meta
		property="og:description"
		content="Enter the password to access Hunter's protected case studies"
	/>
	<meta property="og:type" content="website" />
</svelte:head>

<!-- Handle horizontal bounds -->
<div
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<!-- Grid -->
	<div
		class="grid grow auto-rows-min grid-cols-5 gap-x-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<div
			class="col-start-1 col-end-6 mb-8 mt-12 flex flex-col justify-end rounded sm:col-start-4 sm:col-end-7 sm:mb-16 sm:mt-0 sm:h-[25.5rem] md:col-end-8 lg:col-end-10"
		>
			<h2
				class="text-balance text-4xl font-bold tracking-tighter text-stone-800 sm:text-5xl md:text-6xl lg:text-7xl"
			>
				Protected <img
					class="mb-2 inline h-7 sm:mb-3 sm:h-10 md:mb-3 md:h-12 lg:mb-4 lg:h-14"
					src={lockClosed}
					alt=""
				/>
			</h2>
		</div>
		<form
			method="POST"
			use:enhance
			class="col-start-1 col-end-6 flex flex-col gap-4 sm:col-start-4 sm:col-end-7"
		>
			<p>To access protected pages, <br /> please enter the password:</p>

			<span class="flex h-12 gap-4">
				<input
					name="password"
					type="password"
					class="min-w-0 flex-1 rounded border px-4 pt-0.5 {form?.incorrect
						? 'border-red-500'
						: 'border-stone-300'}"
				/>
				<button
					class="rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300"
					>Submit</button
				>
			</span>
			{#if form?.incorrect}
				<p class="-mt-2 text-xs font-medium uppercase tracking-wider text-red-500">
					Invalid password
				</p>
			{/if}
		</form>
	</div>
</div>
