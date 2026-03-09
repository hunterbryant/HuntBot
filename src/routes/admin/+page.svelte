<script lang="ts">
	import { dev } from '$app/environment';

	let notionStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
	let notionProgress = 0;
	let notionTotal = 0;
	let notionMessage = '';
	let notionCurrentPage = '';
	let notionChunks = 0;

	const triggerURLEmbedding = async () => {
		console.log('Beginning url embedding...');

		await fetch('/api/embed/urls', {
			method: 'GET'
		});
	};

	const triggerNotionURLEmbedding = async () => {
		notionStatus = 'running';
		notionProgress = 0;
		notionTotal = 0;
		notionMessage = 'Connecting to Notion...';
		notionCurrentPage = '';
		notionChunks = 0;

		const response = await fetch('/api/embed/notion-url');
		const reader = response.body?.getReader();
		if (!reader) {
			notionStatus = 'error';
			notionMessage = 'Failed to connect';
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			let eventType = '';
			for (const line of lines) {
				if (line.startsWith('event: ')) {
					eventType = line.slice(7);
				} else if (line.startsWith('data: ') && eventType) {
					try {
						const data = JSON.parse(line.slice(6));

						if (eventType === 'status') {
							notionMessage = data.message;
							if (data.total) notionTotal = data.total;
						} else if (eventType === 'progress') {
							notionProgress = data.current;
							notionTotal = data.total;
							notionCurrentPage = data.title;
							if (data.chunks) notionChunks = data.chunks;
						} else if (eventType === 'done') {
							notionStatus = 'done';
							notionMessage = data.message;
							notionProgress = notionTotal;
						} else if (eventType === 'error') {
							notionStatus = 'error';
							notionMessage = data.message;
						}
					} catch {
						// skip malformed JSON
					}
					eventType = '';
				}
			}
		}

		if (notionStatus === 'running') {
			notionStatus = 'done';
		}
	};

	const triggerNotionFileEmbedding = async () => {
		console.log('Beginning Notion file embedding...');

		await fetch('/api/embed/notion-file', {
			method: 'GET'
		});
	};

	const triggerTextEmbedding = async () => {
		console.log('Beginning text embedding...');

		await fetch('/api/embed/texts', {
			method: 'GET'
		});
	};

	$: notionPercent = notionTotal > 0 ? Math.round((notionProgress / notionTotal) * 100) : 0;
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

			<!-- Notion URL indexing with progress -->
			<div class="flex flex-col gap-2">
				<span class="flex h-12 items-center justify-between gap-4 align-middle">
					Notion API URL indexing
					<button
						on:click={triggerNotionURLEmbedding}
						disabled={notionStatus === 'running'}
						class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
						>{notionStatus === 'running' ? 'Indexing...' : 'Index'}</button
					>
				</span>

				{#if notionStatus !== 'idle'}
					<div class="flex flex-col gap-1.5">
						<!-- Progress bar -->
						<div class="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
							<div
								class="h-full rounded-full transition-all duration-300 ease-out {notionStatus === 'error' ? 'bg-red-500' : notionStatus === 'done' ? 'bg-green-500' : 'bg-blue-600'}"
								style="width: {notionStatus === 'running' && notionTotal === 0 ? '5' : notionPercent}%"
							/>
						</div>

						<!-- Status text -->
						<div class="flex items-center justify-between">
							<p class="truncate text-xs text-stone-400 dark:text-stone-500">
								{#if notionStatus === 'running' && notionTotal > 0}
									{notionCurrentPage}
								{:else}
									{notionMessage}
								{/if}
							</p>
							{#if notionTotal > 0}
								<p class="shrink-0 text-xs text-stone-400 dark:text-stone-500">
									{notionProgress}/{notionTotal} pages · {notionChunks} chunks
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Notion File indexing
				<button
					on:click={triggerNotionFileEmbedding}
					disabled={!dev}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:text-stone-300 disabled:hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-stone-900"
					>Index</button
				>
			</span>
			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Text Export indexing
				<button
					on:click={triggerTextEmbedding}
					disabled={!dev}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:text-stone-300 disabled:hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-stone-900"
					>Index</button
				>
			</span>
		</div>
	</div>
</div>
