<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicLink, PrismicRichText } from '@prismicio/svelte';

	export let slice: Content.RecognitionSlice;

	//Silences runtime svelte unused prop warnings
	$$restProps;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 gap-y-4 sm:mb-16 md:mb-32"
>
	<!-- Out of box metadata -->
	<div
		class="col-span-1 col-start-1 row-start-1 mt-0.5 flex flex-col justify-start gap-2 text-left text-xs uppercase tracking-wider text-stone-500 sm:col-start-3 dark:text-stone-400"
	>
		Recognition
	</div>

	<!-- Award Blocks -->
	<div
		class="col-span-full grid grid-flow-col-dense auto-rows-min grid-cols-subgrid grid-rows-5 gap-x-4 gap-y-8 sm:col-start-4 lg:grid-cols-6"
	>
		{#each slice.items as item}
			<div class="col-span-full flex h-min flex-col gap-2 first:row-span-5 lg:col-span-3">
				<div class="flex items-start gap-2">
					<h3 class="flex-grow font-bold leading-tight text-stone-800 dark:text-stone-200">
						{item.title}
					</h3>
					<p
						class="rounded bg-stone-200 p-1 pb-[2px] text-xs uppercase tracking-wider text-stone-900 dark:bg-stone-800 dark:text-stone-100"
					>
						{item.year}
					</p>
				</div>
				<div class=" *:text-stone-600 dark:*:text-stone-400">
					<PrismicRichText field={item.description} />
				</div>
				<PrismicLink
					field={item.link_url}
					class=" text-stone-600 decoration-slate-400 decoration-2 underline-offset-2 transition-all hover:underline dark:text-stone-400 dark:decoration-slate-600"
					>{item.link_label} ↗</PrismicLink
				>
			</div>
		{/each}
	</div>
</section>
