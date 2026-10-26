<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import ConversationRow from './ConversationRow.svelte';
	import Transcript from './Transcript.svelte';
	import {
		attentionScore,
		formatTime,
		needsAttention,
		type ConversationSummary,
		type TranscriptItem
	} from './types';

	type SortBy = 'recent' | 'messages' | 'duration';
	type TranscriptState = {
		status: 'loading' | 'loaded' | 'error';
		items: TranscriptItem[];
		error: string;
		truncated?: boolean;
	};

	const RANGES = [1, 7, 30, 90];
	const DAY_MS = 24 * 60 * 60 * 1000;

	let conversations: ConversationSummary[] = [];
	let status: 'loading' | 'loaded' | 'error' = 'loading';
	let error = '';
	let fetchedAt = '';
	let truncated = false;

	// Filters: all applied in the browser, and mirrored into the URL so a view can be shared
	let range = 30;
	let selectedPage: string | null = null;
	let sortBy: SortBy = 'recent';
	let attentionOnly = false;
	let hideAdmin = true;
	let hasMessagesOnly = true;
	let showSuggestions = false;

	let expanded = new Set<string>();
	let transcripts = new Map<string, TranscriptState>();
	let copied: { id: string; kind: 'json' | 'link' } | null = null;

	// Everything except "has messages", so the funnel can still count visitors who never typed
	$: since = Date.now() - range * DAY_MS;
	$: scoped = conversations
		.filter((c) => new Date(c.lastActiveAt).getTime() >= since)
		.filter((c) => !selectedPage || c.pages.includes(selectedPage))
		.filter((c) => !hideAdmin || !(c.isAdmin || c.isTest || c.pages.some((p) => p.startsWith('/admin'))));

	$: listed = scoped
		.filter((c) => !hasMessagesOnly || c.userMsgCount > 0)
		.filter((c) => !attentionOnly || needsAttention(c));

	$: sorted = [...listed].sort((a, b) => {
		if (attentionOnly) {
			const diff = attentionScore(b) - attentionScore(a);
			if (diff) return diff;
		}
		if (sortBy === 'messages') return b.msgCount - a.msgCount;
		if (sortBy === 'duration') return b.durationMs - a.durationMs;
		return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
	});

	$: uniquePages = [...new Set(conversations.flatMap((c) => c.pages))].sort();

	const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null);

	$: totalMessages = listed.reduce((n, c) => n + c.msgCount, 0);
	$: totalUserMessages = listed.reduce((n, c) => n + c.userMsgCount, 0);
	$: totalClicks = listed.reduce((n, c) => n + c.suggestionClickCount, 0);
	$: navCount = listed.filter((c) => c.hasNavigation).length;
	$: attentionCount = scoped.filter(needsAttention).length;
	$: avgMessages = listed.length ? (totalMessages / listed.length).toFixed(1) : '0';

	// Opened = tapped the chat open, or messaged (older sessions have no chat_opened event)
	$: openedCount = scoped.filter((c) => c.opened || c.msgCount > 0).length;
	$: messagedCount = scoped.filter((c) => c.userMsgCount > 0).length;
	$: contactCount = scoped.filter((c) => c.contactClicks > 0).length;

	$: bars = buildBars(listed, range);

	function dayKey(ts: number) {
		return new Date(ts).toLocaleDateString('en-CA');
	}

	function buildBars(list: ConversationSummary[], days: number) {
		if (days < 7) return [];
		const counts = new Map<string, number>();
		// By last activity, like the range filter, so the bars add up to the list
		for (const c of list) {
			const key = dayKey(new Date(c.lastActiveAt).getTime());
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const out: { key: string; n: number }[] = [];
		for (let i = days - 1; i >= 0; i--) {
			const key = dayKey(Date.now() - i * DAY_MS);
			out.push({ key, n: counts.get(key) ?? 0 });
		}
		return out;
	}
	$: barMax = Math.max(1, ...bars.map((b) => b.n));

	// --- URL state ---

	function readUrl() {
		const p = $page.url.searchParams;
		const r = Number(p.get('range'));
		if (RANGES.includes(r)) range = r;
		selectedPage = p.get('page');
		const sort = p.get('sort');
		if (sort === 'messages' || sort === 'duration') sortBy = sort;
		attentionOnly = p.get('attention') === '1';
		hideAdmin = p.get('admin') !== '0';
		hasMessagesOnly = p.get('empty') !== '0';
		showSuggestions = p.get('suggestions') === '1';
	}

	function writeUrl() {
		const p = new URLSearchParams();
		if (range !== 30) p.set('range', String(range));
		if (selectedPage) p.set('page', selectedPage);
		if (sortBy !== 'recent') p.set('sort', sortBy);
		if (attentionOnly) p.set('attention', '1');
		if (!hideAdmin) p.set('admin', '0');
		if (!hasMessagesOnly) p.set('empty', '0');
		if (showSuggestions) p.set('suggestions', '1');
		if (expanded.size === 1) p.set('s', [...expanded][0]);
		const qs = p.toString();
		goto($page.url.pathname + (qs ? `?${qs}` : ''), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	// --- Data ---

	async function load(fresh = false) {
		status = 'loading';
		error = '';
		try {
			const res = await fetch(`/api/admin/conversations${fresh ? '?fresh=1' : ''}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			conversations = data.conversations ?? [];
			fetchedAt = data.fetchedAt;
			truncated = data.truncated === true;
			status = 'loaded';
			if (fresh) {
				// Expanded rows stay open across a refresh, so re-fetch their transcripts
				transcripts = new Map();
				inflight.clear();
				for (const c of conversations) if (expanded.has(c.sessionId)) void loadTranscript(c);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	// One request per session at a time, so callers (expand, copy JSON) wait for the same result
	const inflight = new Map<string, Promise<TranscriptState>>();

	function loadTranscript(c: ConversationSummary): Promise<TranscriptState> {
		const existing = transcripts.get(c.sessionId);
		if (existing && existing.status === 'loaded') return Promise.resolve(existing);
		const pending = inflight.get(c.sessionId);
		if (pending) return pending;
		const request = fetchTranscript(c).finally(() => {
			if (inflight.get(c.sessionId) === request) inflight.delete(c.sessionId);
		});
		inflight.set(c.sessionId, request);
		return request;
	}

	async function fetchTranscript(c: ConversationSummary): Promise<TranscriptState> {
		transcripts.set(c.sessionId, { status: 'loading', items: [], error: '' });
		transcripts = transcripts;
		let next: TranscriptState;
		try {
			const qs = new URLSearchParams({ from: c.startedAt, to: c.lastActiveAt });
			const res = await fetch(`/api/admin/conversations/${encodeURIComponent(c.sessionId)}?${qs}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			next = {
				status: 'loaded',
				items: data.items ?? [],
				error: '',
				truncated: data.truncated === true
			};
		} catch (e) {
			next = { status: 'error', items: [], error: e instanceof Error ? e.message : String(e) };
		}
		transcripts.set(c.sessionId, next);
		transcripts = transcripts;
		return next;
	}

	function toggle(c: ConversationSummary) {
		if (expanded.has(c.sessionId)) {
			expanded.delete(c.sessionId);
		} else {
			expanded.add(c.sessionId);
			void loadTranscript(c);
		}
		expanded = expanded;
		writeUrl();
	}

	function flash(id: string, kind: 'json' | 'link') {
		copied = { id, kind };
		setTimeout(() => (copied = null), 1500);
	}

	async function copyJson(c: ConversationSummary) {
		const t = await loadTranscript(c);
		await navigator.clipboard.writeText(JSON.stringify({ ...c, items: t.items }, null, 2));
		flash(c.sessionId, 'json');
	}

	async function copyLink(c: ConversationSummary) {
		const url = new URL($page.url.pathname, $page.url.origin);
		url.searchParams.set('s', c.sessionId);
		await navigator.clipboard.writeText(url.toString());
		flash(c.sessionId, 'link');
	}

	function setFilter(change: () => void) {
		change();
		writeUrl();
	}

	onMount(async () => {
		readUrl();
		const open = $page.url.searchParams.get('s');
		await load();
		const target = open && conversations.find((c) => c.sessionId === open);
		if (target) {
			// A shared link has to show its session even if the filters would hide it
			attentionOnly = false;
			hideAdmin = false;
			hasMessagesOnly = false;
			range = 90;
			selectedPage = null;
			expanded.add(target.sessionId);
			expanded = expanded;
			void loadTranscript(target);
			await tick();
			document.getElementById(`s-${target.sessionId}`)?.scrollIntoView({ block: 'start' });
		}
	});

	const pillOn = 'bg-stone-800 text-stone-100 dark:bg-stone-200 dark:text-stone-800';
	const pillOff =
		'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300';
	const pill = 'rounded-full px-3 py-1 text-xs font-medium transition-colors';
	const statLabel = 'text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500';
	const statValue = 'text-sm font-semibold text-stone-800 dark:text-stone-200';
	const statNote = 'text-xs font-normal text-stone-400 dark:text-stone-500';
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
			<!-- Row 1: time range + count + refresh -->
			<div class="flex items-center justify-between gap-4">
				<div class="flex gap-1">
					{#each RANGES as d}
						<button
							on:click={() => setFilter(() => (range = d))}
							class="{pill} {range === d ? pillOn : pillOff}"
						>
							{d === 1 ? '24h' : `${d}d`}
						</button>
					{/each}
				</div>

				<div class="flex items-center gap-3">
					{#if fetchedAt && status !== 'loading'}
						<p class="text-xs text-stone-400 dark:text-stone-500">
							{listed.length} session{listed.length !== 1 ? 's' : ''} · {formatTime(fetchedAt)}
						</p>
					{/if}
					<button
						on:click={() => load(true)}
						disabled={status === 'loading'}
						class="rounded border border-stone-300 px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
					>
						{status === 'loading' ? 'Loading…' : 'Refresh'}
					</button>
				</div>
			</div>

			{#if status === 'loaded' && conversations.length > 0}
				<!-- Row 2: filters + sort -->
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex flex-wrap items-center gap-2">
						<select
							value={selectedPage}
							on:change={(e) => setFilter(() => (selectedPage = e.currentTarget.value || null))}
							class="rounded border border-stone-200 bg-transparent px-2 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
						>
							<option value="">All pages</option>
							{#each uniquePages as p}
								<option value={p}>{p}</option>
							{/each}
						</select>

						<button
							on:click={() => setFilter(() => (attentionOnly = !attentionOnly))}
							class="{pill} {attentionOnly ? 'bg-red-600 text-white dark:bg-red-500' : pillOff}"
						>
							Needs attention{attentionCount ? ` · ${attentionCount}` : ''}
						</button>
						<button
							on:click={() => setFilter(() => (showSuggestions = !showSuggestions))}
							class="{pill} {showSuggestions ? pillOn : pillOff}"
						>
							Suggestions
						</button>
						<button
							on:click={() => setFilter(() => (hasMessagesOnly = !hasMessagesOnly))}
							class="{pill} {hasMessagesOnly ? pillOn : pillOff}"
						>
							Has messages
						</button>
						<button
							on:click={() => setFilter(() => (hideAdmin = !hideAdmin))}
							class="{pill} {hideAdmin ? pillOn : pillOff}"
						>
							Hide admin &amp; tests
						</button>
					</div>

					<div class="flex flex-wrap gap-1">
						{#each [['recent', 'Recent'], ['messages', 'Messages'], ['duration', 'Duration']] as [val, text]}
							<button
								on:click={() => setFilter(() => (sortBy = val as SortBy))}
								class="{pill} {sortBy === val ? pillOn : pillOff}"
							>
								{text}
							</button>
						{/each}
					</div>
				</div>

				<!-- Stats -->
				<div class="grid grid-cols-3 gap-x-4 gap-y-3 py-1 sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Opened</span>
						<span class={statValue}>{openedCount}</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Messaged</span>
						<span class={statValue}>
							{messagedCount}
							{#if pct(messagedCount, openedCount) !== null}<span class={statNote}>{pct(messagedCount, openedCount)}%</span>{/if}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Contact</span>
						<span class={statValue}>
							{contactCount}
							{#if pct(contactCount, messagedCount) !== null}<span class={statNote}>{pct(contactCount, messagedCount)}%</span>{/if}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Messages</span>
						<span class={statValue}>{totalMessages} <span class={statNote}>{avgMessages} avg</span></span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Via suggestions</span>
						<span class={statValue}>
							{totalClicks}
							{#if pct(totalClicks, totalUserMessages) !== null}<span class={statNote}>{pct(totalClicks, totalUserMessages)}%</span>{/if}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Navigated</span>
						<span class={statValue}>
							{navCount}
							{#if pct(navCount, listed.length) !== null}<span class={statNote}>{pct(navCount, listed.length)}%</span>{/if}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class={statLabel}>Needs attention</span>
						<span class="text-sm font-semibold {attentionCount ? 'text-red-500 dark:text-red-400' : 'text-stone-800 dark:text-stone-200'}">
							{attentionCount}
						</span>
					</div>
				</div>

				{#if bars.length}
					<svg
						viewBox="0 0 {bars.length * 4} 24"
						preserveAspectRatio="none"
						class="h-8 w-full text-stone-300 dark:text-stone-600"
						role="img"
						aria-label="Sessions per day"
					>
						{#each bars as bar, i}
							{@const h = bar.n ? Math.max(2, (bar.n / barMax) * 22) : 0.5}
							<rect x={i * 4} y={24 - h} width="3" height={h} fill="currentColor">
								<title>{bar.key}: {bar.n} session{bar.n !== 1 ? 's' : ''}</title>
							</rect>
						{/each}
					</svg>
				{/if}
			{/if}

			{#if status === 'loading'}
				<div class="flex flex-col gap-3">
					{#each [1, 2, 3, 4, 5] as n (n)}
						<div class="animate-pulse rounded border border-stone-200 p-4 dark:border-stone-700">
							<div class="h-3.5 w-3/4 rounded bg-stone-200 dark:bg-stone-700"></div>
							<div class="mt-2 h-3 w-48 rounded bg-stone-100 dark:bg-stone-800"></div>
						</div>
					{/each}
				</div>
			{/if}

			{#if status === 'error'}
				<p class="text-xs text-red-500">{error}</p>
			{/if}

			{#if status === 'loaded' && truncated}
				<p class="text-xs text-amber-600 dark:text-amber-400">
					Showing the most recent 2,000 sessions. Older ones and the 90d funnel counts are incomplete.
				</p>
			{/if}

			{#if status === 'loaded' && sorted.length === 0}
				<p class="text-sm text-stone-400 dark:text-stone-500">
					{conversations.length ? 'No conversations match these filters.' : 'No conversations yet.'}
				</p>
			{/if}

			{#if status === 'loaded'}
				{#each sorted as convo (convo.sessionId)}
					{@const t = transcripts.get(convo.sessionId)}
					<ConversationRow
						{convo}
						expanded={expanded.has(convo.sessionId)}
						copied={copied?.id === convo.sessionId ? copied.kind : null}
						on:toggle={() => toggle(convo)}
						on:copyjson={() => copyJson(convo)}
						on:copylink={() => copyLink(convo)}
					>
						<Transcript
							{convo}
							status={t?.status ?? 'loading'}
							items={t?.items ?? []}
			truncated={t?.truncated ?? false}
							error={t?.error ?? ''}
							{showSuggestions}
						/>
					</ConversationRow>
				{/each}
			{/if}
		</div>
	</div>
</div>
