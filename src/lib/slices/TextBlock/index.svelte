<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicRichText } from '@prismicio/svelte';

	export let slice: Content.TextBlockSlice;

	//Silences runtime svelte unused prop warnings
	$$restProps;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="[&>p]:text-md col-span-full mb-8 flex flex-col items-stretch gap-8 text-stone-800 *:text-balance sm:col-span-4 sm:col-start-4 sm:mb-0 md:mb-32 [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:leading-none [&>h2]:tracking-tight sm:[&>h2]:text-3xl [&>p]:leading-normal sm:[&>p]:text-xl"
>
	<PrismicRichText field={slice.primary.content} />
</section>
