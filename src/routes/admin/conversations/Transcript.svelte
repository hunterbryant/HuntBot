<script lang="ts">
	import { LOW_GROUNDING, type ConversationSummary, type TranscriptItem } from './types';

	export let convo: ConversationSummary;
	export let status: 'loading' | 'loaded' | 'error' = 'loading';
	export let items: TranscriptItem[] = [];
	export let error = '';
	export let truncated = false;
	export let showSuggestions = false;

	let expandedResponses = new Set<string>();

	function toggleResponse(key: string) {
		if (expandedResponses.has(key)) expandedResponses.delete(key);
		else expandedResponses.add(key);
		expandedResponses = expandedResponses;
	}

	function fnLabel(name: string, args: string | null): string {
		if (!args) return name;
		try {
			const parsed = JSON.parse(args);
			const detail = parsed.page ?? parsed.intent_type ?? parsed.question ?? null;
			return detail ? `${name} · ${detail}` : name;
		} catch {
			return name;
		}
	}

	$: meta = convo.meta;
	$: location = [meta.city, meta.region, meta.country].filter(Boolean).join(', ');
	$: hasMeta = !!(location || meta.timezone || meta.ip || meta.arrivedVia || convo.org || meta.gpc);

	const label = 'w-16 shrink-0 font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400';
	const chip =
		'rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400 dark:bg-stone-800 dark:text-stone-500';
</script>

<div class="border-t border-stone-200 px-4 pb-4 pt-3 dark:border-stone-700">
	{#if hasMeta}
		<div
			class="mb-4 flex flex-col gap-1 rounded bg-stone-50 p-3 text-xs text-stone-400 dark:bg-stone-800/50 dark:text-stone-500"
		>
			{#if location}
				<div class="flex gap-3"><span class={label}>Location</span><span>{location}</span></div>
			{/if}
			{#if meta.timezone}
				<div class="flex gap-3"><span class={label}>Timezone</span><span>{meta.timezone}</span></div>
			{/if}
			{#if meta.arrivedVia}
				<div class="flex gap-3"><span class={label}>Arrived</span><span>{meta.arrivedVia}</span></div>
			{/if}
			{#if convo.org}
				<div class="flex gap-3">
					<span class={label}>Company</span>
					<span>{convo.org}{convo.orgSource ? ` (${convo.orgSource})` : ''}</span>
				</div>
			{/if}
			{#if meta.gpc}
				<div class="flex gap-3">
					<span class={label}>Privacy</span><span>Global Privacy Control on</span>
				</div>
			{/if}
			{#if meta.lat !== null && meta.lon !== null}
				<div class="flex gap-3">
					<span class={label}>Coords</span>
					<span>{meta.lat.toFixed(4)}, {meta.lon.toFixed(4)}</span>
				</div>
			{/if}
			{#if meta.ip}
				<div class="flex gap-3">
					<span class={label}>IP</span><span class="font-mono">{meta.ip}</span>
				</div>
			{/if}
		</div>
	{/if}

	{#if status === 'loading'}
		<div class="flex animate-pulse flex-col gap-3">
			<div class="h-3 w-2/3 rounded bg-stone-200 dark:bg-stone-700"></div>
			<div class="h-3 w-full rounded bg-stone-100 dark:bg-stone-800"></div>
			<div class="h-3 w-5/6 rounded bg-stone-100 dark:bg-stone-800"></div>
		</div>
	{:else if status === 'error'}
		<p class="text-xs text-red-500">{error}</p>
	{:else}
		{#if truncated}
			<p class="mb-3 text-xs text-amber-600 dark:text-amber-400">
				Showing the latest events only; the start of this conversation is cut off.
			</p>
		{/if}
		<div class="flex flex-col gap-3">
			{#each items as item, i}
				{#if item.type === 'chat_message'}
					{@const key = `${convo.sessionId}-${i}`}
					{@const isLong = (item.botResponse?.length ?? 0) > 300}
					{@const showFull = expandedResponses.has(key)}
					{@const low = item.grounding !== null && item.grounding < LOW_GROUNDING}
					<div
						class="flex flex-col gap-2 {i > 0
							? 'border-t border-stone-100 pt-3 dark:border-stone-800'
							: ''}"
					>
						{#if item.currentPage}
							<span class="w-fit {chip}">{item.currentPage}</span>
						{/if}
						{#if item.userMessage}
							<p class="text-sm font-medium text-stone-800 dark:text-stone-200">
								{item.userMessage}
							</p>
						{/if}

						{#if item.fnName}
							<div
								class="flex items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-stone-100 py-1 pl-3 pr-1.5 text-xs font-medium uppercase tracking-wider text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
							>
								<span>{fnLabel(item.fnName, item.fnArgs)}</span>
							</div>
						{/if}

						{#if item.botResponse}
							<p class="text-sm text-stone-500 dark:text-stone-400">
								{isLong && !showFull ? item.botResponse.slice(0, 300) + '…' : item.botResponse}
							</p>
							{#if isLong}
								<button
									on:click={() => toggleResponse(key)}
									class="self-start text-xs text-stone-400 underline hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
								>
									{showFull ? 'show less' : 'show more'}
								</button>
							{/if}
						{/if}

						<!-- What produced the reply: lane, model, tools, and how well it was grounded -->
						<div class="flex flex-wrap gap-1.5">
							{#if item.lane}<span class={chip}>{item.lane}</span>{/if}
							{#if item.model}<span class={chip}>{item.model}</span>{/if}
							{#each item.serverTools as tool}<span class={chip}>{tool}</span>{/each}
							{#if item.grounding !== null}
								<span
									class="rounded px-1.5 py-0.5 text-xs {low
										? 'bg-red-100 font-medium text-red-600 dark:bg-red-900/40 dark:text-red-400'
										: chip}"
								>
									grounding {item.grounding.toFixed(1)}/3
								</span>
							{/if}
							{#if item.admitsMiss}
								<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">missed</span>
							{/if}
							{#if item.spokeAsHunter}
								<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">spoke as Hunter</span>
							{/if}
							{#if item.modelFailure}
								<span class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/40 dark:text-red-400">{item.modelFailure}</span>
							{/if}
						</div>
					</div>
				{:else if item.type === 'suggestions_shown'}
					{#if showSuggestions && item.suggestions.length}
						<div class="flex flex-wrap items-center gap-1.5 pl-1">
							<span class="text-xs text-stone-400 dark:text-stone-500">suggested</span>
							{#each item.suggestions as s}
								<span
									class="rounded-full border border-slate-200 px-3.5 py-1 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-500"
								>
									{s}
								</span>
							{/each}
						</div>
					{/if}
				{:else if item.type === 'suggestion_clicked'}
					<div class="flex items-center gap-1.5 pl-1">
						<span class="text-xs text-stone-400 dark:text-stone-500">clicked</span>
						<span
							class="rounded-full border border-slate-300 bg-slate-50 px-3.5 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
						>
							{item.text}
						</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
