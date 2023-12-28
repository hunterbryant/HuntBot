<script lang="ts">
	import { SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';
	import { navEngaged } from '$lib/nav/navstore';

	export let data;

	navEngaged.set(true);
</script>

<svelte:head>
	<title>{data.page.data.meta_title}</title>
	<meta name="description" content={data.page.data.meta_description} />
	<meta property="og:title" content={data.page.data.meta_title} />
	<meta property="og:description" content={data.page.data.meta_description} />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={data.page.data.meta_image.url} />
</svelte:head>

<div class="flex h-screen justify-center p-8">
	<h1 class="text-xl">About</h1>
	<SliceZone slices={data.page.data.slices} {components} />
</div>
