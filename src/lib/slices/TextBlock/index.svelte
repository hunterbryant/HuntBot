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
	class="prose prose-stone col-span-full mb-4 flex flex-col items-stretch gap-2 text-base text-stone-800 lg:prose-lg *:mb-4 *:mt-0 *:text-balance prose-headings:pb-1 prose-headings:font-bold prose-headings:leading-none prose-headings:tracking-tight prose-a:text-blue-600 prose-a:no-underline prose-a:decoration-2 prose-a:underline-offset-2 hover:prose-a:underline sm:col-span-3
	 sm:col-start-4 sm:mb-8 md:col-end-8 lg:col-end-9 [&>h2:not(:first-child)]:mt-3 [&>h2]:mb-4 sm:[&>h2]:text-3xl [&>h3]:mb-2 [&>h6]:mb-0 [&>h6]:text-lg [&>ol>li]:mb-2 [&>ol]:ml-2 [&>p]:leading-normal [&>p]:text-stone-600 [&_strong]:text-stone-800"
>
	<PrismicRichText field={slice.primary.content} />
</section>
