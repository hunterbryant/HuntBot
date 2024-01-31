<script lang="ts">
	import { SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';

	export let data;
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
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<!-- Grid -->
	<div
		class="grid grow auto-rows-min grid-cols-5 gap-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<div
			class="col-start-1 col-end-6 mb-8 mt-12 flex flex-col justify-end rounded text-6xl font-bold tracking-tighter text-stone-800 sm:col-start-4 sm:col-end-7 sm:mt-0 sm:h-[24.5rem] sm:text-5xl md:col-end-8 md:mb-32 md:text-6xl lg:col-end-10 lg:text-7xl xl:text-8xl dark:text-stone-200"
		>
			<h2 class="mb-0 text-balance text-stone-800 sm:-mb-2 md:-mb-3 lg:-mb-4 dark:text-stone-200">
				{data.page.data.header}
			</h2>
		</div>

		<section
			class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 gap-y-8 sm:col-start-4"
		>
			<SliceZone slices={data.page.data.slices} {components} />
		</section>
	</div>
</div>
