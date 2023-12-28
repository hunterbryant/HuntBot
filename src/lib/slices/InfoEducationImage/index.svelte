<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicRichText, PrismicImage } from '@prismicio/svelte';

	export let slice: Content.InfoEducationImageSlice;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 sm:mb-0"
>
	<!-- Out of box metadata -->
	<div
		class="col-span-1 col-start-3 row-start-2 mt-1 flex flex-col justify-start gap-2 text-right text-xs uppercase tracking-wider text-stone-500"
	>
		Education
	</div>

	<!-- Text Block -->
	<div
		class="col-span-3 col-start-4 mb-8 flex flex-col gap-8 text-balance text-stone-900 *:row-span-1 *:flex *:flex-col"
	>
		<PrismicRichText field={slice.primary.body} />
	</div>

	<!-- Education Block -->
	<div
		class="col-span-3 col-start-4 row-start-2 flex flex-col gap-8 text-balance text-stone-900 *:row-span-1 *:flex *:flex-col *:gap-4"
	>
		<PrismicRichText field={slice.primary.education} />
	</div>

	<!-- Image Column -->
	<div class="col-span-3 row-span-2 row-start-1 flex flex-col gap-8">
		<PrismicImage field={slice.primary.image} class="h-full rounded object-cover" />
	</div>
</section>
