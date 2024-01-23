<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicEmbed } from '@prismicio/svelte';

	export let slice: Content.EmbedBlockSlice;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-10 flex flex-col items-start justify-stretch gap-2 *:flex *:*:h-56 *:w-full *:*:flex-1 *:*:rounded *:*:border *:*:border-black/10 sm:col-span-3 sm:col-start-4 sm:mb-12 sm:*:*:h-96 md:col-end-8 lg:col-end-9"
>
	<PrismicEmbed field={slice.primary.embed} />
</section>
