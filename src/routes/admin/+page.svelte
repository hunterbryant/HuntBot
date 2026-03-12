<script lang="ts">
	import { dev } from '$app/environment';
	import { onMount } from 'svelte';

	// --- Conversations tab ---
	interface ConversationEvent {
		type: 'chat_message' | 'suggestion_clicked';
		timestamp: string;
		userMessage: string | null;
		botResponse: string | null;
		functionCallName: string | null;
		functionCallArgs: string | null;
		currentPage: string | null;
		suggestionText: string | null;
	}
	interface Conversation {
		sessionId: string;
		startedAt: string;
		lastActiveAt: string;
		events: ConversationEvent[];
	}

	let activeTab: 'embedding' | 'conversations' = 'embedding';
	let conversations: Conversation[] = [];
	let convoStatus: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
	let convoError = '';
	let convoDays = 30;
	let convoFetchedAt = '';

	async function fetchConversations() {
		convoStatus = 'loading';
		convoError = '';
		try {
			const res = await fetch(`/api/admin/conversations?days=${convoDays}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			conversations = data.conversations ?? [];
			convoFetchedAt = data.fetchedAt;
			convoStatus = 'loaded';
		} catch (e) {
			convoError = String(e);
			convoStatus = 'error';
		}
	}

	function formatTime(ts: string) {
		return new Date(ts).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function parseFnArgs(args: string | null): string {
		if (!args) return '';
		try {
			const parsed = JSON.parse(args);
			return parsed.page ?? parsed.intent_type ?? parsed.question ?? '';
		} catch {
			return args;
		}
	}

	let notionStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
	let notionProgress = 0;
	let notionTotal = 0;
	let notionMessage = '';
	let notionCurrentPage = '';
	let notionChunks = 0;

	// iMessage state
	let imessageToggle = false;
	let imessageToggleLoading = false;
	let imessageStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
	let imessageMessage = '';
	let imessageProgress = 0;
	let imessageTotal = 0;
	let imessagePurging = false;
	let imessageDays = 365;
	let imessageOnlyMe = true;
	let imessageExcludeContacts = '';
	let imessageContactAliases = '';

	onMount(async () => {
		try {
			const res = await fetch('/api/admin/imessage-toggle');
			const data = await res.json();
			imessageToggle = data.enabled;
		} catch {
			// leave default
		}
	});

	const toggleImessage = async () => {
		imessageToggleLoading = true;
		try {
			const res = await fetch('/api/admin/imessage-toggle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !imessageToggle })
			});
			const data = await res.json();
			imessageToggle = data.enabled;
		} finally {
			imessageToggleLoading = false;
		}
	};

	const triggerImessageEmbedding = async () => {
		imessageStatus = 'running';
		imessageProgress = 0;
		imessageTotal = 0;
		imessageMessage = 'Opening iMessage database...';

		const params = new URLSearchParams({
			days: String(imessageDays),
			onlyMe: String(imessageOnlyMe)
		});
		if (imessageExcludeContacts.trim()) {
			params.set('excludeContacts', imessageExcludeContacts.trim());
		}
		if (imessageContactAliases.trim()) {
			params.set('contactAliases', imessageContactAliases.trim());
		}

		const response = await fetch(`/api/embed/imessage?${params}`);
		const reader = response.body?.getReader();
		if (!reader) {
			imessageStatus = 'error';
			imessageMessage = 'Failed to connect';
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
							imessageMessage = data.message;
							if (data.totalChunks) imessageTotal = data.totalChunks;
						} else if (eventType === 'progress') {
							imessageProgress = data.current;
							imessageTotal = data.total;
						} else if (eventType === 'done') {
							imessageStatus = 'done';
							imessageMessage = data.message;
							imessageProgress = imessageTotal;
						} else if (eventType === 'error') {
							imessageStatus = 'error';
							imessageMessage = data.message;
						}
					} catch {
						// skip malformed JSON
					}
					eventType = '';
				}
			}
		}

		if (imessageStatus === 'running') {
			imessageStatus = 'done';
		}
	};

	const purgeImessageData = async () => {
		if (!confirm('Delete all iMessage data from the vector store?')) return;
		imessagePurging = true;
		try {
			const res = await fetch('/api/embed/imessage/purge', { method: 'POST' });
			const data = await res.json();
			if (data.success) {
				imessageMessage = 'iMessage data purged from Qdrant';
				imessageStatus = 'done';
			} else {
				imessageMessage = `Purge failed: ${data.error}`;
				imessageStatus = 'error';
			}
		} catch (err) {
			imessageMessage = `Purge failed: ${err}`;
			imessageStatus = 'error';
		} finally {
			imessagePurging = false;
		}
	};

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
	$: imessagePercent = imessageTotal > 0 ? Math.round((imessageProgress / imessageTotal) * 100) : 0;
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
			<!-- Tab switcher -->
			<div class="flex gap-1 border-b border-stone-200 dark:border-stone-700">
				<button
					on:click={() => (activeTab = 'embedding')}
					class="px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors {activeTab === 'embedding'
						? 'border-b-2 border-stone-800 text-stone-800 dark:border-stone-200 dark:text-stone-200'
						: 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'}"
				>
					Embedding
				</button>
				<button
					on:click={() => {
						activeTab = 'conversations';
						if (convoStatus === 'idle') fetchConversations();
					}}
					class="px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors {activeTab === 'conversations'
						? 'border-b-2 border-stone-800 text-stone-800 dark:border-stone-200 dark:text-stone-200'
						: 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'}"
				>
					Conversations
				</button>
			</div>

			{#if activeTab === 'embedding'}
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

			<!-- iMessage Section -->
			<div class="mt-8 border-t border-stone-200 pt-6 dark:border-stone-700">
				<p
					class="mb-4 text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400"
				>
					iMessage Context
				</p>

				<!-- Toggle -->
				<span class="flex h-12 items-center justify-between gap-4 align-middle">
					<span class="flex items-center gap-2">
						<span
							class="inline-block h-2 w-2 rounded-full {imessageToggle
								? 'bg-green-500'
								: 'bg-stone-400'}"
						/>
						Include iMessage context in retrieval
					</span>
					<button
						on:click={toggleImessage}
						disabled={imessageToggleLoading}
						class="h-full rounded border px-4 text-xs font-medium uppercase tracking-wider transition-colors {imessageToggle
							? 'border-green-600 text-green-600 hover:bg-green-600 hover:text-white dark:border-green-500 dark:text-green-500 dark:hover:bg-green-500 dark:hover:text-white'
							: 'border-stone-300 hover:bg-stone-300 dark:border-stone-700 dark:hover:bg-stone-700'} disabled:cursor-not-allowed disabled:opacity-50"
					>
						{imessageToggle ? 'On' : 'Off'}
					</button>
				</span>

				<!-- Filters -->
				<div class="mt-4 flex flex-col gap-3">
					<div class="flex items-center justify-between gap-4">
						<label for="imessage-days" class="text-sm text-stone-600 dark:text-stone-400"
							>Days of history</label
						>
						<input
							id="imessage-days"
							type="number"
							min="1"
							max="3650"
							bind:value={imessageDays}
							class="w-24 rounded border border-stone-300 bg-transparent px-3 py-1.5 text-sm dark:border-stone-700"
						/>
					</div>

					<label class="flex items-center justify-between gap-4">
						<span class="text-sm text-stone-600 dark:text-stone-400"
							>Only my messages (recommended)</span
						>
						<input
							type="checkbox"
							bind:checked={imessageOnlyMe}
							class="h-4 w-4 rounded border-stone-300 accent-blue-600 dark:border-stone-700"
						/>
					</label>

					<div class="flex flex-col gap-1">
						<label
							for="imessage-exclude"
							class="text-sm text-stone-600 dark:text-stone-400"
							>Exclude contacts (comma-separated)</label
						>
						<input
							id="imessage-exclude"
							type="text"
							placeholder="+15551234567, email@example.com"
							bind:value={imessageExcludeContacts}
							class="rounded border border-stone-300 bg-transparent px-3 py-1.5 text-sm dark:border-stone-700"
						/>
					</div>

					<div class="flex flex-col gap-1">
						<label
							for="imessage-aliases"
							class="text-sm text-stone-600 dark:text-stone-400"
							>Contact name overrides <span class="font-normal opacity-60">(optional)</span></label
						>
						<textarea
							id="imessage-aliases"
							rows="2"
							placeholder="+15551234567=Work Nickname, anon@example.com=Friend"
							bind:value={imessageContactAliases}
							class="rounded border border-stone-300 bg-transparent px-3 py-1.5 text-sm leading-relaxed dark:border-stone-700"
						/>
						<p class="text-xs text-stone-400 dark:text-stone-500">
							Names are auto-resolved from your macOS Contacts. Add overrides here only for
							contacts not in your address book or where you want a different name.
						</p>
					</div>
				</div>

				<!-- Index + Purge buttons -->
				<div class="mt-4 flex flex-col gap-2">
					<span class="flex h-12 items-center justify-between gap-4 align-middle">
						iMessage indexing
						<span class="flex gap-2">
							<button
								on:click={purgeImessageData}
								disabled={!dev || imessagePurging}
								class="h-full rounded border border-red-400 px-4 text-xs font-medium uppercase tracking-wider text-red-500 transition-colors hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-600 dark:hover:text-white"
							>
								{imessagePurging ? 'Purging...' : 'Purge'}
							</button>
							<button
								on:click={triggerImessageEmbedding}
								disabled={!dev || imessageStatus === 'running'}
								class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
							>
								{imessageStatus === 'running' ? 'Indexing...' : 'Index'}
							</button>
						</span>
					</span>

					{#if imessageStatus !== 'idle'}
						<div class="flex flex-col gap-1.5">
							<div
								class="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
							>
								<div
									class="h-full rounded-full transition-all duration-300 ease-out {imessageStatus === 'error'
										? 'bg-red-500'
										: imessageStatus === 'done'
											? 'bg-green-500'
											: 'bg-blue-600'}"
									style="width: {imessageStatus === 'running' && imessageTotal === 0
										? '5'
										: imessagePercent}%"
								/>
							</div>
							<p class="text-xs text-stone-400 dark:text-stone-500">
								{imessageMessage}
								{#if imessageTotal > 0 && imessageStatus === 'running'}
									· {imessageProgress}/{imessageTotal} chunks
								{/if}
							</p>
						</div>
					{/if}
				</div>
			</div>

		{:else}

		<!-- Conversations tab -->
		<div class="flex flex-col gap-4">
			<!-- Controls -->
			<div class="flex items-center justify-between gap-4">
				<p class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400">
					Recent Conversations
				</p>
				<div class="flex items-center gap-2">
					<select
						bind:value={convoDays}
						on:change={fetchConversations}
						class="rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700"
					>
						<option value={1}>Last 24h</option>
						<option value={7}>Last 7 days</option>
						<option value={30}>Last 30 days</option>
						<option value={90}>Last 90 days</option>
					</select>
					<button
						on:click={fetchConversations}
						disabled={convoStatus === 'loading'}
						class="rounded border border-stone-300 px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700"
					>
						{convoStatus === 'loading' ? 'Loading...' : 'Refresh'}
					</button>
				</div>
			</div>

			{#if convoFetchedAt}
				<p class="text-xs text-stone-400 dark:text-stone-500">
					{conversations.length} conversation{conversations.length !== 1 ? 's' : ''} · fetched {formatTime(convoFetchedAt)}
				</p>
			{/if}

			{#if convoStatus === 'error'}
				<p class="text-xs text-red-500">{convoError}</p>
			{/if}

			{#if convoStatus === 'loaded' && conversations.length === 0}
				<p class="text-sm text-stone-400 dark:text-stone-500">No conversations in this period.</p>
			{/if}

			{#each conversations as convo (convo.sessionId)}
				<div class="flex flex-col gap-3 rounded border border-stone-200 p-4 dark:border-stone-700">
					<!-- Session header -->
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-stone-400 dark:text-stone-500">
							{formatTime(convo.startedAt)}
						</span>
						<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
							{convo.events.filter((e) => e.type === 'chat_message').length} msg{convo.events.filter((e) => e.type === 'chat_message').length !== 1 ? 's' : ''}
						</span>
					</div>

					<!-- Events -->
					{#each convo.events as event, i}
						{#if event.type === 'chat_message'}
							<div class="flex flex-col gap-1.5 {i > 0 ? 'border-t border-stone-100 pt-3 dark:border-stone-800' : ''}">
								<!-- Page badge -->
								{#if event.currentPage}
									<span class="w-fit rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400 dark:bg-stone-800 dark:text-stone-500">
										{event.currentPage}
									</span>
								{/if}
								<!-- User message -->
								{#if event.userMessage}
									<p class="text-sm font-medium text-stone-800 dark:text-stone-200">
										{event.userMessage}
									</p>
								{/if}
								<!-- Tool call -->
								{#if event.functionCallName}
									<p class="text-xs text-blue-600 dark:text-blue-400">
										→ {event.functionCallName}{#if parseFnArgs(event.functionCallArgs)} · {parseFnArgs(event.functionCallArgs)}{/if}
									</p>
								{/if}
								<!-- Bot response -->
								{#if event.botResponse}
									<p class="text-sm text-stone-500 dark:text-stone-400">
										{event.botResponse.length > 300 ? event.botResponse.slice(0, 300) + '…' : event.botResponse}
									</p>
								{/if}
							</div>
						{:else if event.type === 'suggestion_clicked'}
							<p class="pl-2 text-xs text-stone-400 dark:text-stone-500">
								↳ clicked: <span class="italic">{event.suggestionText}</span>
							</p>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
		{/if}

		</div>
	</div>
</div>
