<script lang="ts">
	import { dev } from '$app/environment';

	const triggerURLEmbedding = async () => {
		console.log('Beginning url embedding...');

		await fetch('/api/embed/urls', {
			method: 'GET'
		});
	};

	const triggerNotionURLEmbedding = async () => {
		console.log('Beginning Notion API URL embedding...');

		await fetch('/api/embed/notion-url', {
			method: 'GET'
		});
	};

	const triggerNotionFileEmbedding = async () => {
		console.log('Beginning Notion file embedding...');

		await fetch('/api/embed/notion-file', {
			method: 'GET'
		});
	};
</script>

<svelte:head>
	<title>Admin</title>
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
				class="flex items-center gap-2 text-balance text-4xl font-bold tracking-tighter text-stone-800 sm:text-5xl md:gap-2 md:text-6xl lg:gap-2 lg:text-7xl dark:text-stone-200 [&_svg]:mb-2 [&_svg]:size-8 sm:[&_svg]:mb-2 sm:[&_svg]:size-10 md:[&_svg]:mb-2 md:[&_svg]:size-12 lg:[&_svg]:mb-3 lg:[&_svg]:size-16"
			>
				Admin Controls
			</h2>
		</div>

		<div
			class="col-start-1 col-end-6 flex flex-col gap-4 text-stone-800 sm:col-start-4 sm:col-end-7 dark:text-stone-200"
		>
			<p class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400">
				Embedding Processing Triggers
			</p>

			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Jank manual site crawling
				<button
					on:click={triggerURLEmbedding}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 dark:border-stone-700 dark:hover:bg-stone-700"
					>Index</button
				>
			</span>
			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Notion API URL indexing
				<button
					on:click={triggerNotionURLEmbedding}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 dark:border-stone-700 dark:hover:bg-stone-700"
					>Index</button
				>
			</span>
			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Notion File indexing
				<button
					on:click={triggerNotionFileEmbedding}
					disabled={!dev}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:text-stone-300 disabled:hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-stone-900"
					>Index</button
				>
			</span>
		</div>
	</div>
</div>
