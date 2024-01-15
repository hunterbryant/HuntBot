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
	class="prose prose-stone prose-headings:pb-1 hover:prose-a:underline prose-a:no-underline prose-a:text-blue-600 prose-a:decoration-2 prose-a::underline-offset-2 col-span-full mb-4 flex flex-col items-stretch gap-2 text-base text-stone-800 *:mb-4 *:mt-0 *:text-balance sm:col-span-3 sm:col-start-4 sm:mb-8 md:col-end-8 [&>h2:not(:first-child)]:mt-3
	 [&>h2]:mb-4 [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:leading-none [&>h2]:tracking-tight sm:[&>h2]:text-3xl [&>h3]:mb-2 [&>h3]:text-xl [&>h3]:font-bold [&>h6]:mb-0 [&>h6]:text-lg [&>h6]:font-bold [&>ol>li]:mb-2 [&>ol]:ml-2 [&>ol]:list-outside [&>ol]:list-decimal [&>p]:leading-normal [&>p]:text-stone-700 [&>ul]:ml-2 [&>ul]:list-outside [&>ul]:list-disc [&_strong]:text-stone-800"
>
	<PrismicRichText field={slice.primary.content} />
</section>
