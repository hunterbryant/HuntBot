<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicLink } from '@prismicio/svelte';

	export let slice: Content.LinksSlice;

	//Silences runtime svelte unused prop warnings
	$$restProps;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 gap-y-4 sm:mb-0 md:mb-32"
>
	<!-- Out of box metadata -->
	<div
		class="col-span-1 col-start-1 row-start-1 flex h-11 flex-col items-start justify-center gap-2 text-left text-xs uppercase tracking-wider text-stone-500 sm:col-start-3 dark:text-stone-400"
	>
		Links
	</div>

	<!-- Link Blocks -->
	<div
		class="col-span-full grid grid-flow-row auto-rows-min grid-cols-subgrid gap-x-4 gap-y-2 sm:col-start-4 lg:grid-cols-6"
	>
		{#each slice.items as item}
			<div class="col-span-full flex h-min flex-col gap-2 md:col-span-2 lg:col-span-2">
				<PrismicLink
					field={item.link}
					class="flex h-11 items-center justify-between rounded  font-bold leading-tight text-stone-800 decoration-slate-400 decoration-2 underline-offset-2 transition-all hover:bg-stone-200 hover:px-2 dark:text-stone-200 dark:decoration-slate-600 dark:hover:bg-stone-800"
					>{item.label}
					<p>↗</p>
				</PrismicLink>
			</div>
		{/each}
	</div>
</section>
