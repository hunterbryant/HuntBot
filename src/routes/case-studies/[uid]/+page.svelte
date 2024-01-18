<script lang="ts">
	import { PrismicImage, SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<title>{data.page.data.meta_title}</title>
	<meta name="description" content={data.page.data.meta_description} />
	<meta property="og:title" content={data.page.data.meta_title} />
	<meta property="og:description" content={data.page.data.meta_description} />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={data.page.data.meta_image.url} />
</svelte:head>

<!-- Handle horizontal bounds -->
<div
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-[4.75rem] sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<!-- Grid -->
	<div class="grid grow grid-cols-5 gap-x-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9">
		<div
			class="col-start-1 col-end-6 mb-6 flex flex-col justify-start gap-8 overflow-hidden sm:col-span-full sm:col-start-4 sm:gap-16 md:col-end-8 md:mb-12 lg:col-end-10"
		>
			<PrismicImage
				class="aspect-video rounded object-cover sm:h-[24.5rem] sm:rounded-b sm:rounded-t-none"
				field={data.page.data.hightlight_image}
			/>
			<h2
				class="text-balance text-4xl font-bold tracking-tighter text-stone-800 sm:text-5xl md:text-6xl lg:text-7xl"
			>
				{data.page.data.title}
			</h2>
		</div>
		<SliceZone slices={data.page.data.slices} {components} />
	</div>
</div>
