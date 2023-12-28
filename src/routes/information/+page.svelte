<script lang="ts">
	import { SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';

	export let data;
</script>

<svelte:head>
	<title>About – Hunter Bryant</title>
	<meta name="description" content="About Hunter Bryant" />
</svelte:head>

<div class="flex h-screen justify-center p-8">
	<h1 class="text-xl">About</h1>
	<SliceZone slices={data.page.data.slices} {components} />
</div>
