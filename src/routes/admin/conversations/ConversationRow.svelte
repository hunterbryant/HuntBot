<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { formatDate, formatTime, LOW_GROUNDING, type ConversationSummary } from './types';

	export let convo: ConversationSummary;
	export let expanded = false;
	export let copied: 'json' | 'link' | null = null;

	const dispatch = createEventDispatcher<{ toggle: void; copyjson: void; copylink: void }>();

	function formatDuration(ms: number): string {
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return '< 1 min';
		if (mins < 60) return `${mins} min`;
		const hours = Math.floor(mins / 60);
		return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
	}

	// A company is a guess unless the visitor said so (or picked it with /simulate)
	function sourceNote(source: string | null): string {
		if (source === 'stated' || source === 'simulated') return source;
		return source ? 'guess' : '';
	}

	// The list filters and sorts by last activity, so that's the time shown. A session resumed on a
	// later day (the session id lives in localStorage) also says when it started.
	$: resumed =
		new Date(convo.startedAt).toLocaleDateString('en-CA') !==
		new Date(convo.lastActiveAt).toLocaleDateString('en-CA');

	$: location = [convo.meta.city, convo.meta.region, convo.meta.country].filter(Boolean).join(', ');
	$: suggestedPct =
		convo.userMsgCount > 0
			? Math.round((convo.suggestionClickCount / convo.userMsgCount) * 100)
			: null;
	$: lowGrounding = convo.minGrounding !== null && convo.minGrounding < LOW_GROUNDING;

	const badge = 'rounded px-1.5 py-0.5 text-xs font-medium';
</script>

<div id="s-{convo.sessionId}" class="rounded border border-stone-200 dark:border-stone-700">
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		on:click={() => dispatch('toggle')}
		class="flex w-full cursor-pointer items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
	>
		<div class="flex min-w-0 flex-col gap-1.5">
			<!-- What the conversation was about -->
			<p class="truncate text-sm font-medium text-stone-800 dark:text-stone-200">
				{convo.firstQuestion ?? 'No message sent'}
			</p>

			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span class="text-xs text-stone-400 dark:text-stone-500"
					>{formatTime(convo.lastActiveAt)}{#if resumed}
						· started {formatDate(convo.startedAt)}{/if}</span
				>
				<span class="{badge} bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
					{convo.msgCount} msg{convo.msgCount !== 1 ? 's' : ''}
				</span>
				<span class="text-xs text-stone-400 dark:text-stone-500">{formatDuration(convo.durationMs)}</span>
				{#if suggestedPct !== null && suggestedPct > 0}
					<span class="text-xs text-stone-400 dark:text-stone-500">{suggestedPct}% suggested</span>
				{/if}
				{#if convo.org}
					<span class="{badge} bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
						{convo.org}{#if sourceNote(convo.orgSource)}
							<span class="font-normal opacity-70"> · {sourceNote(convo.orgSource)}</span>
						{/if}
					</span>
				{/if}
				{#if convo.hasNavigation}
					<span class="{badge} bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">tool call</span>
				{/if}
				{#if convo.contactClicks}
					<span class="{badge} bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">contact</span>
				{/if}
				{#if convo.failures}
					<span class="{badge} bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">error</span>
				{/if}
				{#if convo.notHelpfulCount}
					<span class="{badge} bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">not helpful</span>
				{/if}
				{#if lowGrounding}
					<span class="{badge} bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">
						low grounding {convo.minGrounding?.toFixed(1)}
					</span>
				{/if}
				{#if convo.misses}
					<span class="{badge} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
						missed{convo.misses > 1 ? ` ×${convo.misses}` : ''}
					</span>
				{/if}
				{#if convo.spokeAsHunter}
					<span class="{badge} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">as Hunter</span>
				{/if}
			</div>

			{#if convo.pages.length}
				<p class="truncate text-xs text-stone-500 dark:text-stone-400">{convo.pages.join(' → ')}</p>
			{/if}
			{#if convo.navDest}
				<p class="text-xs font-medium text-mud-600 dark:text-mud-400">→ {convo.navDest}</p>
			{/if}
			{#if location || convo.meta.timezone}
				<div class="flex flex-wrap gap-1.5">
					{#each [location, convo.meta.timezone].filter(Boolean) as pill}
						<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400 dark:bg-stone-800 dark:text-stone-500">{pill}</span>
					{/each}
				</div>
			{/if}
		</div>

		<div class="mt-0.5 flex shrink-0 items-center gap-2">
			<button
				on:click|stopPropagation={() => dispatch('copylink')}
				title="Copy link to this conversation"
				class="rounded px-1.5 py-0.5 text-xs transition-colors {copied === 'link'
					? 'text-green-500 dark:text-green-400'
					: 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'}"
			>
				{copied === 'link' ? 'linked' : 'link'}
			</button>
			<button
				on:click|stopPropagation={() => dispatch('copyjson')}
				title="Copy conversation as JSON"
				class="rounded px-1.5 py-0.5 font-mono text-xs transition-colors {copied === 'json'
					? 'text-green-500 dark:text-green-400'
					: 'text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400'}"
			>
				{copied === 'json' ? 'copied' : convo.sessionId.slice(0, 8)}
			</button>
			<span class="text-stone-400 transition-transform dark:text-stone-500 {expanded ? 'rotate-90' : ''}">›</span>
		</div>
	</div>

	{#if expanded}
		<slot />
	{/if}
</div>
