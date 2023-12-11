<script lang="ts">
	import { SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<title>{data.page.data.title}</title>
	<meta name="description" content="Gathers" />
</svelte:head>

<SliceZone slices={data.page.data.slices} {components} />
