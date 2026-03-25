<script lang="ts">
	import { PRIMARY_HERO_HEADLINE_SEGMENTS } from './heroPhrases';

	/** Bound to the `<h1>` for scroll / intersection logic in the parent page */
	export let headlineElement: HTMLElement | undefined = undefined;
</script>

<h1
	class="absolute -top-[3.09rem] my-auto text-5xl font-medium tracking-tighter text-stone-900 sm:relative sm:top-0 sm:z-40 xl:text-5xl dark:text-stone-100 dark:mix-blend-exclusion"
	bind:this={headlineElement}
>
	{#each PRIMARY_HERO_HEADLINE_SEGMENTS as seg}
		{#if seg.italic}
			<span class="font-serif italic">{seg.text}</span>
		{:else}
			{seg.text}
		{/if}
	{/each}
</h1>
