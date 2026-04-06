<script lang="ts">
	import { onMount } from 'svelte';

	let currentStatus: string | null = null;
	let inputText = '';
	let suggestions: string[] = [];
	let saving = false;
	let suggesting = false;

	onMount(async () => {
		try {
			const res = await fetch('/api/admin/status');
			const data = await res.json();
			currentStatus = data.text || null;
		} catch {
			// leave default
		}
	});

	async function saveStatus() {
		saving = true;
		try {
			const res = await fetch('/api/admin/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: inputText })
			});
			const data = await res.json();
			currentStatus = data.text || null;
			inputText = '';
			suggestions = [];
		} finally {
			saving = false;
		}
	}

	async function clearStatus() {
		saving = true;
		try {
			const res = await fetch('/api/admin/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: '' })
			});
			const data = await res.json();
			currentStatus = data.text || null;
			inputText = '';
			suggestions = [];
		} finally {
			saving = false;
		}
	}

	async function suggest() {
		if (!inputText.trim()) return;
		suggesting = true;
		try {
			const res = await fetch('/api/admin/status/suggest', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ input: inputText })
			});
			const data = await res.json();
			suggestions = data.suggestions || [];
		} finally {
			suggesting = false;
		}
	}
</script>

<svelte:head>
	<title>Admin</title>
</svelte:head>

<div
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<div
		class="grid grow auto-rows-min grid-cols-5 gap-x-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<div
			class="col-start-1 col-end-6 mb-8 mt-12 flex flex-col justify-end rounded sm:col-start-4 sm:col-end-7 sm:mb-16 sm:mt-0 sm:h-[25.5rem] md:col-end-8 lg:col-end-10"
		>
			<h2
				class="flex items-center gap-2 text-balance text-4xl font-bold tracking-tighter text-stone-800 sm:text-5xl md:gap-2 md:text-6xl lg:gap-2 lg:text-7xl dark:text-stone-200"
			>
				Admin
			</h2>
		</div>

		<!-- Status Easter Egg -->
		<div
			class="col-start-1 col-end-6 mb-6 flex flex-col gap-3 sm:col-start-4 sm:col-end-7 md:col-end-8 lg:col-end-10"
		>
			<p class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
				Status
			</p>

			{#if currentStatus}
				<p class="text-sm text-stone-600 dark:text-stone-400">
					Current: <span class="font-medium">{currentStatus}</span>
				</p>
			{:else}
				<p class="text-sm text-stone-400 dark:text-stone-500">No status set</p>
			{/if}

			<div class="flex gap-2">
				<input
					type="text"
					bind:value={inputText}
					placeholder="e.g. eating birria in mexico city"
					class="flex-1 rounded border border-stone-200 bg-transparent px-3 py-2 text-sm text-stone-800 placeholder-stone-400 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:text-stone-200 dark:placeholder-stone-600 dark:focus:border-stone-600"
				/>
				<button
					on:click={suggest}
					disabled={suggesting || !inputText.trim()}
					class="shrink-0 rounded border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-900"
				>
					{suggesting ? 'Thinking…' : 'Suggest'}
				</button>
			</div>

			{#if suggestions.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each suggestions as suggestion}
						<button
							on:click={() => (inputText = suggestion)}
							class="rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-200"
						>
							{suggestion}
						</button>
					{/each}
				</div>
			{/if}

			<div class="flex gap-2">
				<button
					on:click={saveStatus}
					disabled={saving || !inputText.trim()}
					class="rounded bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300"
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
				{#if currentStatus}
					<button
						on:click={clearStatus}
						disabled={saving}
						class="rounded border border-stone-200 px-4 py-2 text-sm text-stone-500 transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-stone-800 dark:hover:bg-stone-900"
					>
						Clear
					</button>
				{/if}
			</div>
		</div>

		<div
			class="col-start-1 col-end-6 flex flex-col gap-2 text-stone-800 sm:col-start-4 sm:col-end-7 md:col-end-8 lg:col-end-10 dark:text-stone-200"
		>
			<a
				href="/admin/conversations"
				class="flex h-14 items-center justify-between rounded border border-stone-200 px-4 text-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"
			>
				<span class="font-medium">Conversations</span>
				<span class="text-stone-400 dark:text-stone-500">›</span>
			</a>
			<a
				href="/admin/embeddings"
				class="flex h-14 items-center justify-between rounded border border-stone-200 px-4 text-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"
			>
				<span class="font-medium">Embeddings</span>
				<span class="text-stone-400 dark:text-stone-500">›</span>
			</a>
		</div>
	</div>
</div>
