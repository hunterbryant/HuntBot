<script lang="ts">
	import { onMount } from 'svelte';

	// URL crawl state
	let urlStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';

	// Notion state
	let notionStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
	let notionProgress = 0;
	let notionTotal = 0;
	let notionMessage = '';
	let notionCurrentPage = '';
	let notionChunks = 0;

	// Notion file state
	let notionFileStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';

	// Text export state
	let textStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';

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

	// Chunk audit state — the audit runs on the server; this page only starts it and shows the
	// progress saved after each run.
	type ChunkAuditStatus = {
		state: 'running' | 'paused' | 'done' | 'error';
		startedAt: string;
		finishedAt: string | null;
		audited: number;
		lowValue: number;
		sensitive: number;
		refused: number;
		error: string | null;
	};
	type ChunkAuditEstimate = {
		totalChunks: number;
		untaggedChunks: number | null;
		tokensPerChunk: number;
		basis: 'measured' | 'default';
		usdPerMillionInput: number;
		fullAuditUsd: number;
		remainingUsd: number | null;
	};
	let auditStatus: ChunkAuditStatus | null = null;
	let auditEstimate: ChunkAuditEstimate | null = null;
	let auditStale = false;
	let auditStarting = false;
	// Why the last start or status check failed (expired login, server error); shown in red.
	let auditError = '';
	let auditPoll: ReturnType<typeof setTimeout> | undefined;
	// Vercel stops the server's chain of runs after a few hops and the job pauses; a request from
	// this page starts a fresh chain, so it resumes on its own while the page is open. Only after
	// progress, so a job that keeps pausing without tagging anything doesn't loop.
	let autoResumedAt = -1;

	const AUDIT_POLL_MS = 5000;

	const refreshAuditStatus = async () => {
		clearTimeout(auditPoll);
		try {
			const res = await fetch('/api/admin/chunk-audit');
			if (res.status === 401) {
				auditError = 'Your admin login has expired. Log in again to check or start the audit.';
				return;
			}
			const data = await res.json();
			auditStatus = data.status;
			auditStale = data.stale;
			auditEstimate = data.estimate ?? null;
		} catch {
			// keep the last known status
		}
		if (auditStatus?.state === 'paused' && auditStatus.audited > autoResumedAt) {
			autoResumedAt = auditStatus.audited;
			await triggerChunkAudit();
			return;
		}
		if (auditStatus?.state === 'running' && !auditStale) {
			auditPoll = setTimeout(refreshAuditStatus, AUDIT_POLL_MS);
		}
	};

	const triggerChunkAudit = async () => {
		auditStarting = true;
		auditError = '';
		try {
			const res = await fetch('/api/admin/chunk-audit', { method: 'POST' });
			// 409 means a run is already going, which the status line below shows.
			if (res.status === 401) {
				auditError = 'Your admin login has expired. Log in again, then click Audit.';
				return;
			}
			if (!res.ok && res.status !== 409) {
				const data = await res.json().catch(() => ({}));
				auditError = `The audit didn't start: ${data.error ?? `HTTP ${res.status}`}`;
				return;
			}
		} catch (err) {
			auditError = `The audit didn't start: ${err instanceof Error ? err.message : err}`;
			return;
		} finally {
			auditStarting = false;
		}
		await refreshAuditStatus();
	};

	const formatUsd = (usd: number) =>
		usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
	const formatCount = (n: number) => n.toLocaleString();

	const formatAuditTime = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	$: auditRunning = auditStatus?.state === 'running' && !auditStale;
	$: auditCounts = auditStatus
		? `${auditStatus.audited} chunks audited · ${auditStatus.lowValue} boilerplate · ${auditStatus.sensitive} sensitive${auditStatus.refused ? ` · ${auditStatus.refused} refused` : ''}`
		: '';

	onMount(() => {
		refreshAuditStatus();
		return () => clearTimeout(auditPoll);
	});

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

	const triggerURLEmbedding = async () => {
		urlStatus = 'running';
		await fetch('/api/embed/urls', { method: 'GET' });
		urlStatus = 'done';
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

		if (notionStatus === 'running') notionStatus = 'done';
	};

	const triggerNotionFileEmbedding = async () => {
		notionFileStatus = 'running';
		await fetch('/api/embed/notion-file', { method: 'GET' });
		notionFileStatus = 'done';
	};

	const triggerTextEmbedding = async () => {
		textStatus = 'running';
		await fetch('/api/embed/texts', { method: 'GET' });
		textStatus = 'done';
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
		if (imessageExcludeContacts.trim()) params.set('excludeContacts', imessageExcludeContacts.trim());
		if (imessageContactAliases.trim()) params.set('contactAliases', imessageContactAliases.trim());

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

		if (imessageStatus === 'running') imessageStatus = 'done';
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

	$: notionPercent = notionTotal > 0 ? Math.round((notionProgress / notionTotal) * 100) : 0;
	$: imessagePercent = imessageTotal > 0 ? Math.round((imessageProgress / imessageTotal) * 100) : 0;
</script>

<svelte:head>
	<title>Embeddings · Admin</title>
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
			<a
				href="/admin"
				class="mb-4 text-xs font-medium uppercase tracking-wider text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
			>
				← Back to Admin
			</a>
			<h2
				class="flex items-center gap-2 text-balance text-4xl font-bold tracking-tighter text-stone-800 sm:text-5xl md:gap-2 md:text-6xl lg:gap-2 lg:text-7xl dark:text-stone-200"
			>
				Embeddings
			</h2>
		</div>

		<div
			class="col-start-1 col-end-6 flex flex-col gap-4 text-stone-800 sm:col-start-4 sm:col-end-7 md:col-end-8 lg:col-end-10 dark:text-stone-200"
		>
			<!-- Site crawl -->
			<p class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400">
				Web
			</p>

			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Site crawl
				<button
					on:click={triggerURLEmbedding}
					disabled={urlStatus === 'running'}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
				>
					{urlStatus === 'running' ? 'Indexing...' : urlStatus === 'done' ? 'Done' : 'Index'}
				</button>
			</span>

			<!-- Notion -->
			<p class="mt-4 text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400">
				Notion
			</p>

			<!-- Notion URL indexing with progress -->
			<div class="flex flex-col gap-2">
				<span class="flex h-12 items-center justify-between gap-4 align-middle">
					Notion API URL indexing
					<button
						on:click={triggerNotionURLEmbedding}
						disabled={notionStatus === 'running'}
						class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
					>
						{notionStatus === 'running' ? 'Indexing...' : 'Index'}
					</button>
				</span>

				{#if notionStatus !== 'idle'}
					<div class="flex flex-col gap-1.5">
						<div class="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
							<div
								class="h-full rounded-full transition-all duration-300 ease-out {notionStatus === 'error' ? 'bg-red-500' : notionStatus === 'done' ? 'bg-green-500' : 'bg-mud-600'}"
								style="width: {notionStatus === 'running' && notionTotal === 0 ? '5' : notionPercent}%"
							></div>
						</div>
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
				Notion file indexing
				<button
					on:click={triggerNotionFileEmbedding}
					disabled={notionFileStatus === 'running'}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
				>
					{notionFileStatus === 'running' ? 'Indexing...' : notionFileStatus === 'done' ? 'Done' : 'Index'}
				</button>
			</span>

			<span class="flex h-12 items-center justify-between gap-4 align-middle">
				Text export indexing
				<button
					on:click={triggerTextEmbedding}
					disabled={textStatus === 'running'}
					class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
				>
					{textStatus === 'running' ? 'Indexing...' : textStatus === 'done' ? 'Done' : 'Index'}
				</button>
			</span>

			<!-- iMessage -->
			<div class="mt-4 border-t border-stone-200 pt-6 dark:border-stone-700">
				<p class="mb-4 text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400">
					iMessage
				</p>

				<!-- Retrieval toggle -->
				<span class="flex h-12 items-center justify-between gap-4 align-middle">
					<span class="flex items-center gap-2">
						<span
							class="inline-block h-2 w-2 rounded-full {imessageToggle ? 'bg-green-500' : 'bg-stone-400'}"
						></span>
						Include iMessage context in retrieval
					</span>
					<button
						on:click={toggleImessage}
						disabled={imessageToggleLoading}
						class="h-full rounded border px-4 text-xs font-medium uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 {imessageToggle
							? 'border-green-600 text-green-600 hover:bg-green-600 hover:text-white dark:border-green-500 dark:text-green-500 dark:hover:bg-green-500 dark:hover:text-white'
							: 'border-stone-300 hover:bg-stone-300 dark:border-stone-700 dark:hover:bg-stone-700'}"
					>
						{imessageToggle ? 'On' : 'Off'}
					</button>
				</span>

				<!-- Filters -->
				<div class="mt-4 flex flex-col gap-3">
					<div class="flex items-center justify-between gap-4">
						<label for="imessage-days" class="text-sm text-stone-600 dark:text-stone-400">
							Days of history
						</label>
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
						<span class="text-sm text-stone-600 dark:text-stone-400">
							Only my messages (recommended)
						</span>
						<input
							type="checkbox"
							bind:checked={imessageOnlyMe}
							class="h-4 w-4 rounded border-stone-300 accent-mud-600 dark:border-stone-700"
						/>
					</label>

					<div class="flex flex-col gap-1">
						<label for="imessage-exclude" class="text-sm text-stone-600 dark:text-stone-400">
							Exclude contacts (comma-separated)
						</label>
						<input
							id="imessage-exclude"
							type="text"
							placeholder="+15551234567, email@example.com"
							bind:value={imessageExcludeContacts}
							class="rounded border border-stone-300 bg-transparent px-3 py-1.5 text-sm dark:border-stone-700"
						/>
					</div>

					<div class="flex flex-col gap-1">
						<label for="imessage-aliases" class="text-sm text-stone-600 dark:text-stone-400">
							Contact name overrides
							<span class="font-normal opacity-60">(optional)</span>
						</label>
						<textarea
							id="imessage-aliases"
							rows="2"
							placeholder="+15551234567=Work Nickname, anon@example.com=Friend"
							bind:value={imessageContactAliases}
							class="rounded border border-stone-300 bg-transparent px-3 py-1.5 text-sm leading-relaxed dark:border-stone-700"
						></textarea>
						<p class="text-xs text-stone-400 dark:text-stone-500">
							Names are auto-resolved from your macOS Contacts. Add overrides here only for contacts
							not in your address book or where you want a different name.
						</p>
					</div>
				</div>

				<!-- Index + Purge -->
				<div class="mt-4 flex flex-col gap-2">
					<span class="flex h-12 items-center justify-between gap-4 align-middle">
						iMessage indexing
						<span class="flex gap-2">
							<button
								on:click={purgeImessageData}
								disabled={imessagePurging}
								class="h-full rounded border border-red-400 px-4 text-xs font-medium uppercase tracking-wider text-red-500 transition-colors hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-600 dark:hover:text-white"
							>
								{imessagePurging ? 'Purging...' : 'Purge'}
							</button>
							<button
								on:click={triggerImessageEmbedding}
								disabled={imessageStatus === 'running'}
								class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
							>
								{imessageStatus === 'running' ? 'Indexing...' : 'Index'}
							</button>
						</span>
					</span>

					{#if imessageStatus !== 'idle'}
						<div class="flex flex-col gap-1.5">
							<div class="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
								<div
									class="h-full rounded-full transition-all duration-300 ease-out {imessageStatus === 'error'
										? 'bg-red-500'
										: imessageStatus === 'done'
											? 'bg-green-500'
											: 'bg-mud-600'}"
									style="width: {imessageStatus === 'running' && imessageTotal === 0 ? '5' : imessagePercent}%"
								></div>
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

			<!-- Chunk audit -->
			<div class="mt-4 border-t border-stone-200 pt-6 dark:border-stone-700">
				<p class="mb-4 text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-400">
					Quality
				</p>

				<div class="flex flex-col gap-2">
					<span class="flex h-12 items-center justify-between gap-4 align-middle">
						Audit new chunks
						<button
							on:click={triggerChunkAudit}
							disabled={auditRunning || auditStarting}
							class="h-full rounded border border-stone-300 px-4 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-300 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent dark:border-stone-700 dark:hover:bg-stone-700 dark:disabled:text-stone-700 dark:disabled:hover:bg-transparent"
						>
							{auditRunning || auditStarting
								? 'Auditing...'
								: auditStale || auditStatus?.state === 'paused'
									? 'Resume'
									: 'Audit'}
						</button>
					</span>
					<p class="text-xs text-stone-400 dark:text-stone-500">
						Run after indexing. Tags chunks that haven't been audited yet so HuntBot skips
						boilerplate and sensitive ones. Nothing is re-embedded or deleted. It runs in the
						background, so you can close this page and check back here later.
					</p>
					{#if auditEstimate}
						<p class="text-xs text-stone-600 dark:text-stone-300">
							Full audit: {formatCount(auditEstimate.totalChunks)} chunks, about {formatUsd(
								auditEstimate.fullAuditUsd
							)}{#if auditEstimate.untaggedChunks !== null && auditEstimate.remainingUsd !== null}
								· still to audit: {formatCount(auditEstimate.untaggedChunks)}, about {formatUsd(
									auditEstimate.remainingUsd
								)}{/if}
						</p>
						<p class="text-xs text-stone-400 dark:text-stone-500">
							Estimate: ~{formatCount(auditEstimate.tokensPerChunk)} input tokens per chunk ({auditEstimate.basis ===
							'measured'
								? 'measured on this job'
								: 'measured on the first production run'}) at ${auditEstimate.usdPerMillionInput} per
							million on gpt-6-luna.
						</p>
					{/if}
					{#if auditStatus}
						<p class="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
							<span
								class="inline-block h-2 w-2 shrink-0 rounded-full {auditRunning
									? 'animate-pulse bg-mud-600'
									: auditStatus.state === 'done'
										? 'bg-green-500'
										: auditStatus.state === 'paused'
											? 'bg-mud-600'
											: 'bg-red-500'}"
							></span>
							{#if auditRunning}
								Running since {formatAuditTime(auditStatus.startedAt)}
							{:else if auditStatus.state === 'paused'}
								Paused partway (started {formatAuditTime(auditStatus.startedAt)}). Vercel limits how
								many runs can start each other, so it picks up again while this page is open, or click
								Resume
							{:else if auditStale}
								Stopped partway (started {formatAuditTime(auditStatus.startedAt)}) — click Resume
							{:else if auditStatus.state === 'done' && auditStatus.finishedAt}
								Finished {formatAuditTime(auditStatus.finishedAt)}
							{:else}
								Failed: {auditStatus.error}
							{/if}
						</p>
						<p class="text-xs text-stone-400 dark:text-stone-500">{auditCounts}</p>
					{/if}
					{#if auditError}
						<p class="text-xs text-red-500">{auditError}</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
