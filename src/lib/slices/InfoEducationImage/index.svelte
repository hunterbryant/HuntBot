<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicRichText, PrismicImage } from '@prismicio/svelte';

	//Silences runtime svelte unused prop warnings
	$$restProps;

	export let slice: Content.InfoEducationImageSlice;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 sm:mb-0 md:mb-32"
>
	<!-- Out of box metadata -->
	<div
		class="[&_a]: text-stone-500 col-span-1 col-start-1 row-start-3 mt-1 flex flex-col justify-start gap-2 text-left text-xs uppercase tracking-wider underline-offset-2 sm:col-start-3 md:row-start-2"
	>
		Education
	</div>

	<!-- Text Block -->
	<div
		class="text-stone-600 col-span-full col-start-2 row-start-2 mb-8 flex flex-col gap-8 text-balance dark:text-stone-400 *:row-span-1 *:flex *:flex-col sm:col-span-3 sm:col-start-4 md:row-start-1"
	>
		<PrismicRichText field={slice.primary.body} />
	</div>

	<!-- Education Block -->
	<div
		class="text-stone-900 col-span-4 col-start-1 row-start-4 flex flex-col gap-8 text-balance dark:text-stone-100 [&_p]:text-stone-600 dark:[&_p]:text-stone-400 [&_strong]:text-stone-900 dark:[&_strong]:text-stone-100 *:row-span-1 *:flex *:flex-col *:gap-0 sm:col-span-3 sm:col-start-4 sm:row-start-3 sm:*:gap-2 md:row-start-2 [&>p>a]:decoration-slate-400 [&>p>a]:decoration-2 [&>p>a]:transition-all hover:[&>p>a]:underline
		dark:[&>p>a]:decoration-slate-600 [&_br]:mb-2 [&_strong]:text-balance [&_strong]:leading-tight"
	>
		<PrismicRichText field={slice.primary.education} />
	</div>

	<!-- Image Column -->
	<div
		class="col-span-full col-start-1 row-span-1 row-start-1 mb-12 flex flex-col gap-8 sm:col-span-3 sm:col-start-4 md:col-start-auto md:row-span-2 md:row-start-1 md:mb-0"
	>
		<PrismicImage field={slice.primary.image} class="h-full rounded object-cover" />
	</div>
</section>
