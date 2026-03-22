<script lang="ts">
	import { onMount } from 'svelte';

	interface ConversationEvent {
		type: 'chat_message' | 'suggestion_clicked' | 'suggestions_shown';
		timestamp: string;
		userMessage: string | null;
		botResponse: string | null;
		functionCallName: string | null;
		functionCallArgs: string | null;
		currentPage: string | null;
		suggestionText: string | null;
		suggestionsShown: string[] | null;
		suggestionType: string | null;
		city: string | null;
		region: string | null;
		regionCode: string | null;
		country: string | null;
		countryCode: string | null;
		timezone: string | null;
		ip: string | null;
		lat: number | null;
		lon: number | null;
	}

	interface UserMeta {
		city: string | null;
		region: string | null;
		regionCode: string | null;
		country: string | null;
		countryCode: string | null;
		timezone: string | null;
		ip: string | null;
		lat: number | null;
		lon: number | null;
	}

	interface ConversationSummary {
		sessionId: string;
		startedAt: string;
		lastActiveAt: string;
		durationMs: number;
		hasNavigation: boolean;
		hasNotHelpful: boolean;
		userMeta: UserMeta;
		msgCount: number;
		userMsgCount: number;
		suggestionClickCount: number;
		pages: string[];
		pagesVisited: string;
		navDest: string | null;
	}

	let conversations: ConversationSummary[] = [];
	let eventsMap: Record<string, ConversationEvent[]> = {};
	let convoStatus: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
	let convoError = '';
	let convoDays = 30;
	let convoFetchedAt = '';
	let expandedSessions = new Set<string>();
	let expandedBotResponses = new Set<string>();
	let copiedSession: string | null = null;
	let chatOpenedCount = 0;
	let metaStatus: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
	let notHelpfulCount = 0;
	let sortBy: 'recent' | 'messages' | 'duration' = 'recent';
	let selectedPage: string | null = null;
	let showSuggestionsShown = false;
	let hideNoUserMessages = true;
	let hideAdminSessions = true;

	$: uniquePages = [...new Set(conversations.flatMap((c) => c.pages))].sort();

	$: filtered = conversations
		.filter((c) => !selectedPage || c.pages.includes(selectedPage))
		.filter((c) => !hideNoUserMessages || c.userMsgCount > 0)
		.filter((c) => !hideAdminSessions || !c.pages.some((p) => p.startsWith('/admin')));

	$: sorted = [...filtered].sort((a, b) => {
		if (sortBy === 'messages') return b.msgCount - a.msgCount;
		if (sortBy === 'duration') return b.durationMs - a.durationMs;
		return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
	});

	$: totalMessages = filtered.reduce((n, c) => n + c.msgCount, 0);
	$: totalSuggestionClicks = filtered.reduce((n, c) => n + c.suggestionClickCount, 0);
	$: totalUserMessages = filtered.reduce((n, c) => n + c.userMsgCount, 0);
	$: suggestionsPct =
		totalUserMessages > 0 ? Math.round((totalSuggestionClicks / totalUserMessages) * 100) : null;
	$: navCount = filtered.filter((c) => c.hasNavigation).length;
	$: navPct = filtered.length > 0 ? Math.round((navCount / filtered.length) * 100) : 0;
	$: openPct =
		chatOpenedCount > 0 && filtered.length > 0
			? Math.round((filtered.length / chatOpenedCount) * 100)
			: null;
	$: avgMessages = filtered.length > 0 ? (totalMessages / filtered.length).toFixed(1) : '0';

	async function copySession(convo: ConversationSummary) {
		const payload = { ...convo, events: eventsMap[convo.sessionId] ?? [] };
		await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
		copiedSession = convo.sessionId;
		setTimeout(() => (copiedSession = null), 1500);
	}

	function toggleSession(id: string) {
		if (expandedSessions.has(id)) {
			expandedSessions.delete(id);
		} else {
			expandedSessions.add(id);
		}
		expandedSessions = expandedSessions;
	}

	function toggleBotResponse(key: string) {
		if (expandedBotResponses.has(key)) {
			expandedBotResponses.delete(key);
		} else {
			expandedBotResponses.add(key);
		}
		expandedBotResponses = expandedBotResponses;
	}

	let fetchController: AbortController | null = null;
	let metaController: AbortController | null = null;

	async function fetchConversations(force = false) {
		fetchController?.abort();
		metaController?.abort();
		fetchController = new AbortController();
		metaController = new AbortController();
		convoStatus = 'loading';
		metaStatus = 'loading';
		convoError = '';
		chatOpenedCount = 0;

		const cacheMode: RequestCache = force ? 'no-cache' : 'default';

		// Fire core and meta fetches simultaneously — do not await one before the other
		const corePromise = fetch(`/api/admin/conversations?days=${convoDays}`, {
			signal: fetchController.signal,
			cache: cacheMode
		});

		const metaPromise = fetch(`/api/admin/conversations/meta?days=${convoDays}`, {
			signal: metaController.signal,
			cache: cacheMode
		});

		// Resolve core
		corePromise
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				conversations = data.conversations ?? [];
				eventsMap = data.events ?? {};
				notHelpfulCount = data.notHelpfulCount ?? 0;
				convoFetchedAt = data.fetchedAt;
				convoStatus = 'loaded';
			})
			.catch((e: unknown) => {
				if ((e as Error).name === 'AbortError') return;
				convoError = String(e);
				convoStatus = 'error';
			});

		// Resolve meta independently
		metaPromise
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				chatOpenedCount = data.chatOpenedCount ?? 0;
				metaStatus = 'loaded';
			})
			.catch((e: unknown) => {
				if ((e as Error).name === 'AbortError') return;
				metaStatus = 'error';
			});
	}

	function formatTime(ts: string) {
		return new Date(ts).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatDuration(ms: number): string {
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return '< 1 min';
		return `${Math.floor(secs / 60)} min`;
	}

	// Normalise a chat_message event so function call data is always in fnName/fnArgs,
	// even when the OpenAI SDK serialised it into botResponse as raw JSON.
	function resolveEvent(event: ConversationEvent): {
		fnName: string | null;
		fnArgs: string | null;
		responseText: string | null;
	} {
		// Primary path: function call was captured into its own fields
		if (event.functionCallName) {
			return { fnName: event.functionCallName, fnArgs: event.functionCallArgs, responseText: null };
		}
		// Fallback: OpenAI SDK serialised the function call into botResponse as JSON
		if (event.botResponse) {
			try {
				const parsed = JSON.parse(event.botResponse);
				if (parsed.function_call?.name) {
					return {
						fnName: parsed.function_call.name,
						fnArgs: parsed.function_call.arguments ?? null,
						responseText: null
					};
				}
			} catch {
				// not JSON — fall through to plain text
			}
		}
		return { fnName: null, fnArgs: null, responseText: event.botResponse };
	}

	function fnLabel(name: string, args: string | null): string {
		if (!args) return name;
		try {
			const parsed = typeof args === 'string' ? JSON.parse(args) : args;
			const detail = parsed.page ?? parsed.intent_type ?? parsed.question ?? null;
			return detail ? `${name} · ${detail}` : name;
		} catch {
			return name;
		}
	}

	function locationLabel(meta: UserMeta): string {
		return [meta.city, meta.regionCode ?? meta.region, meta.countryCode ?? meta.country]
			.filter(Boolean)
			.join(', ');
	}

	onMount(() => {
		fetchConversations();
	});
</script>

<svelte:head>
	<title>Conversations · Admin</title>
</svelte:head>

<div
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<div
		class="grid grow auto-rows-min grid-cols-5 gap-x-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<!-- Heading stays in the right-rail column -->
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
				Conversations
			</h2>
		</div>

		<div
			class="col-start-1 col-end-6 flex flex-col gap-4 text-stone-800 sm:col-start-4 sm:col-end-7 md:col-end-8 lg:col-end-10 dark:text-stone-200"
		>
			<!-- Row 1: time range pills + session count + refresh -->
			<div class="flex items-center justify-between gap-4">
				<!-- Day range pills -->
				<div class="flex gap-1">
					{#each [1, 7, 30, 90] as d}
						<button
							on:click={() => { convoDays = d; fetchConversations(true); }}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:pointer-events-none {convoDays === d
								? 'bg-stone-800 text-stone-100 dark:bg-stone-200 dark:text-stone-800'
								: 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300'}"
						>
							{d === 1 ? '24h' : d === 7 ? '7d' : d === 30 ? '30d' : '90d'}
						</button>
					{/each}
				</div>

				<div class="flex items-center gap-3">
					{#if convoFetchedAt && convoStatus !== 'loading'}
						<p class="text-xs text-stone-400 dark:text-stone-500">
							{conversations.length} session{conversations.length !== 1 ? 's' : ''} · {formatTime(convoFetchedAt)}
						</p>
					{/if}
					<button
						on:click={() => fetchConversations(true)}
						disabled={convoStatus === 'loading'}
						class="rounded border border-stone-300 px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
					>
						{convoStatus === 'loading' ? 'Loading…' : 'Refresh'}
					</button>
				</div>
			</div>

			<!-- Row 2: page filter + sort + suggestions toggle (only when loaded) -->
			{#if convoStatus === 'loaded' && conversations.length > 0}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<!-- Left: page filter + suggestions toggle -->
					<div class="flex flex-wrap items-center gap-2">
						<!-- Page filter -->
						<select
							bind:value={selectedPage}
							class="rounded border border-stone-200 bg-transparent px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
						>
							<option value={null}>All pages</option>
							{#each uniquePages as page}
								<option value={page}>{page}</option>
							{/each}
						</select>

						<!-- Suggestions toggle -->
						<button
							on:click={() => (showSuggestionsShown = !showSuggestionsShown)}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors {showSuggestionsShown
								? 'bg-stone-800 text-stone-100 dark:bg-stone-200 dark:text-stone-800'
								: 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300'}"
						>
							Suggestions
						</button>

						<!-- Has messages toggle -->
						<button
							on:click={() => (hideNoUserMessages = !hideNoUserMessages)}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors {hideNoUserMessages
								? 'bg-stone-800 text-stone-100 dark:bg-stone-200 dark:text-stone-800'
								: 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300'}"
						>
							Has messages
						</button>

						<!-- Hide admin sessions toggle -->
						<button
							on:click={() => (hideAdminSessions = !hideAdminSessions)}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors {hideAdminSessions
								? 'bg-stone-800 text-stone-100 dark:bg-stone-200 dark:text-stone-800'
								: 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300'}"
						>
							Hide admin
						</button>
					</div>

					<!-- Sort pills -->
					<div class="flex flex-wrap gap-1">
						{#each [{ val: 'recent', label: 'Recent' }, { val: 'messages', label: 'Messages' }, { val: 'duration', label: 'Duration' }] as opt}
							<button
								on:click={() => (sortBy = opt.val === 'messages' ? 'messages' : opt.val === 'duration' ? 'duration' : 'recent')}
								class="rounded-full px-3 py-1 text-xs font-medium transition-colors {sortBy === opt.val
									? 'bg-stone-800 text-stone-100 dark:bg-stone-200 dark:text-stone-800'
									: 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300'}"
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Stats bar -->
				<div class="grid grid-cols-3 gap-x-4 gap-y-3 py-1 sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
					<!-- Sessions -->
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Sessions</span>
						<span class="text-sm font-semibold text-stone-800 dark:text-stone-200">{filtered.length}</span>
					</div>

					<!-- Messages -->
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Messages</span>
						<span class="text-sm font-semibold text-stone-800 dark:text-stone-200">
							{totalMessages}
							<span class="text-xs font-normal text-stone-400 dark:text-stone-500">{avgMessages} avg</span>
						</span>
					</div>

					<!-- Via suggestions -->
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Via suggestions</span>
						<span class="text-sm font-semibold text-stone-800 dark:text-stone-200">
							{totalSuggestionClicks}
							{#if suggestionsPct !== null}
								<span class="text-xs font-normal text-stone-400 dark:text-stone-500">{suggestionsPct}%</span>
							{/if}
						</span>
					</div>

					<!-- Navigated -->
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Navigated</span>
						<span class="text-sm font-semibold text-stone-800 dark:text-stone-200">
							{navCount}
							<span class="text-xs font-normal text-stone-400 dark:text-stone-500">{navPct}%</span>
						</span>
					</div>

					<!-- Opened chat -->
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Opened chat</span>
						{#if metaStatus === 'loading'}
							<span class="text-sm font-semibold text-stone-800 dark:text-stone-200">
								<span class="inline-block h-3.5 w-8 animate-pulse rounded bg-stone-200 align-middle dark:bg-stone-700" />
							</span>
						{:else}
							<span class="text-sm font-semibold text-stone-800 dark:text-stone-200">
								{chatOpenedCount}
								{#if openPct !== null}
									<span class="text-xs font-normal text-stone-400 dark:text-stone-500">{openPct}% messaged</span>
								{:else}
									<span class="text-xs font-normal text-stone-400 dark:text-stone-500">—</span>
								{/if}
							</span>
						{/if}
					</div>

					<!-- Not helpful -->
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Not helpful</span>
						<span class="text-sm font-semibold {notHelpfulCount > 0 ? 'text-red-500 dark:text-red-400' : 'text-stone-800 dark:text-stone-200'}">
							{notHelpfulCount}
							{#if filtered.length > 0}
								<span class="text-xs font-normal text-stone-400 dark:text-stone-500">{Math.round((filtered.filter(c => c.hasNotHelpful).length / filtered.length) * 100)}% of sessions</span>
							{/if}
						</span>
					</div>
				</div>
			{/if}

			<!-- Loading skeleton -->
			{#if convoStatus === 'loading'}
				<div class="flex flex-col gap-3">
					{#each [1, 2, 3, 4, 5] as _}
						<div class="animate-pulse rounded border border-stone-200 p-4 dark:border-stone-700">
							<div class="flex items-center gap-2">
								<div class="h-3 w-24 rounded bg-stone-200 dark:bg-stone-700" />
								<div class="h-3 w-12 rounded bg-stone-200 dark:bg-stone-700" />
							</div>
							<div class="mt-2 h-3 w-48 rounded bg-stone-100 dark:bg-stone-800" />
						</div>
					{/each}
				</div>
			{/if}

			{#if convoStatus === 'error'}
				<p class="text-xs text-red-500">{convoError}</p>
			{/if}

			{#if convoStatus === 'loaded' && conversations.length === 0}
				<p class="text-sm text-stone-400 dark:text-stone-500">No conversations in this period.</p>
			{/if}

			<!-- Conversation cards -->
			{#if convoStatus !== 'loading'}
			{#each sorted as convo (convo.sessionId)}
				{@const expanded = expandedSessions.has(convo.sessionId)}
				{@const loc = locationLabel(convo.userMeta)}
				{@const suggPct = convo.userMsgCount > 0 ? Math.round((convo.suggestionClickCount / convo.userMsgCount) * 100) : null}

				<div class="rounded border border-stone-200 dark:border-stone-700">
					<!-- Collapsed row -->
					<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
					<div
						on:click={() => toggleSession(convo.sessionId)}
						class="flex w-full cursor-pointer items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
					>
						<div class="flex min-w-0 flex-col gap-1.5">
							<!-- Date + message count + duration -->
							<div class="flex items-center gap-2">
								<span class="text-xs text-stone-400 dark:text-stone-500">
									{formatTime(convo.startedAt)}
								</span>
								<span
									class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400"
								>
									{convo.msgCount} msg{convo.msgCount !== 1 ? 's' : ''}
								</span>
								{#if convo.hasNavigation}
									<span class="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">tool call</span>
								{/if}
								{#if convo.hasNotHelpful}
									<span class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/40 dark:text-red-400">not helpful</span>
								{/if}
								<span class="text-xs text-stone-400 dark:text-stone-500">
									{formatDuration(convo.durationMs)}
								</span>
								{#if suggPct !== null}
									<span class="text-xs text-stone-400 dark:text-stone-500">{suggPct}% suggested</span>
								{/if}
							</div>

							<!-- Pages visited -->
							{#if convo.pagesVisited}
								<p class="truncate text-xs text-stone-500 dark:text-stone-400">
									{convo.pagesVisited}
								</p>
							{/if}

							<!-- Nav destination badge -->
							{#if convo.navDest}
								<p class="text-xs font-medium text-mud-600 dark:text-mud-400">
									→ {convo.navDest}
								</p>
							{/if}

							<!-- Not helpful badge -->
							{#if convo.hasNotHelpful}
								<div class="flex items-center gap-1 text-xs font-medium text-red-500 dark:text-red-400">
									<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
										<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z" />
										<path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
									</svg>
									Not helpful
								</div>
							{/if}

							<!-- Meta pills -->
							{#if loc || convo.userMeta.timezone}
								<div class="flex flex-wrap gap-1.5">
									{#if loc}
										<span
											class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400 dark:bg-stone-800 dark:text-stone-500"
										>
											{loc}
										</span>
									{/if}
									{#if convo.userMeta.timezone}
										<span
											class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400 dark:bg-stone-800 dark:text-stone-500"
										>
											{convo.userMeta.timezone}
										</span>
									{/if}
								</div>
							{/if}
						</div>

						<!-- Right-side actions -->
						<div class="mt-0.5 flex shrink-0 items-center gap-2">
							<button
								on:click|stopPropagation={() => copySession(convo)}
								title="Copy conversation as JSON"
								class="rounded px-1.5 py-0.5 font-mono text-xs transition-colors {copiedSession === convo.sessionId
									? 'text-green-500 dark:text-green-400'
									: 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'}"
							>
								{copiedSession === convo.sessionId ? 'copied' : convo.sessionId.slice(0, 8)}
							</button>
							<span
								class="text-stone-400 transition-transform dark:text-stone-500 {expanded
									? 'rotate-90'
									: ''}"
							>
								›
							</span>
						</div>
					</div>

					<!-- Expanded content -->
					{#if expanded}
						{@const sessionEvents = eventsMap[convo.sessionId] ?? []}
						<div class="border-t border-stone-200 px-4 pb-4 pt-3 dark:border-stone-700">
							<!-- User meta block -->
							{#if loc || convo.userMeta.timezone || convo.userMeta.ip}
								<div
									class="mb-4 flex flex-col gap-1 rounded bg-stone-50 p-3 text-xs text-stone-400 dark:bg-stone-800/50 dark:text-stone-500"
								>
									{#if loc}
										<div class="flex gap-3">
											<span class="w-16 shrink-0 font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Location</span>
											<span>
												{[convo.userMeta.city, convo.userMeta.region, convo.userMeta.country]
													.filter(Boolean)
													.join(', ')}
											</span>
										</div>
									{/if}
									{#if convo.userMeta.timezone}
										<div class="flex gap-3">
											<span class="w-16 shrink-0 font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Timezone</span>
											<span>{convo.userMeta.timezone}</span>
										</div>
									{/if}
									{#if convo.userMeta.lat && convo.userMeta.lon}
										<div class="flex gap-3">
											<span class="w-16 shrink-0 font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Coords</span>
											<span>{convo.userMeta.lat.toFixed(4)}, {convo.userMeta.lon.toFixed(4)}</span>
										</div>
									{/if}
									{#if convo.userMeta.ip}
										<div class="flex gap-3">
											<span class="w-16 shrink-0 font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">IP</span>
											<span class="font-mono">{convo.userMeta.ip}</span>
										</div>
									{/if}
								</div>
							{/if}

							<!-- Events transcript -->
							<div class="flex flex-col gap-3">
								{#each sessionEvents as event, i}
									{#if event.type === 'chat_message'}
										{@const responseKey = `${convo.sessionId}-${i}`}
										{@const resolved = resolveEvent(event)}
										{@const isLong = (resolved.responseText?.length ?? 0) > 300}
										{@const showFull = expandedBotResponses.has(responseKey)}
										<div
											class="flex flex-col gap-2 {i > 0
												? 'border-t border-stone-100 pt-3 dark:border-stone-800'
												: ''}"
										>
											{#if event.currentPage}
												<span
													class="w-fit rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400 dark:bg-stone-800 dark:text-stone-500"
												>
													{event.currentPage}
												</span>
											{/if}
											{#if event.userMessage}
												<p class="text-sm font-medium text-stone-800 dark:text-stone-200">
													{event.userMessage}
												</p>
											{/if}

											<!-- Tool call — styled like ActionMessage -->
											{#if resolved.fnName}
												<div class="flex items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-stone-100 py-1 pl-3 pr-1.5 text-xs font-medium uppercase tracking-wider text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
													<span>{fnLabel(resolved.fnName, resolved.fnArgs)}</span>
												</div>
											{/if}

											{#if resolved.responseText}
												<p class="text-sm text-stone-500 dark:text-stone-400">
													{isLong && !showFull
														? resolved.responseText.slice(0, 300) + '…'
														: resolved.responseText}
												</p>
												{#if isLong}
													<button
														on:click={() => toggleBotResponse(responseKey)}
														class="self-start text-xs text-stone-400 underline hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
													>
														{showFull ? 'show less' : 'show more'}
													</button>
												{/if}
											{/if}
										</div>

									{:else if event.type === 'suggestions_shown'}
										{#if showSuggestionsShown && event.suggestionsShown?.length}
											<!-- Suggestion list — styled like ChatSuggestions chips -->
											<div class="flex flex-wrap items-center gap-1.5 pl-1">
												<span class="text-xs text-stone-400 dark:text-stone-500">suggested</span>
												{#each event.suggestionsShown as s}
													<span
														class="rounded-full border border-slate-200 px-3.5 py-1 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-500"
													>
														{s}
													</span>
												{/each}
											</div>
										{/if}
									{:else if event.type === 'suggestion_clicked'}
										<!-- Clicked chip — same style but highlighted -->
										<div class="flex items-center gap-1.5 pl-1">
											<span class="text-xs text-stone-400 dark:text-stone-500">clicked</span>
											<span
												class="rounded-full border border-slate-300 bg-slate-50 px-3.5 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
											>
												{event.suggestionText}
											</span>
										</div>
									{/if}
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
			{/if}
		</div>
	</div>
</div>
