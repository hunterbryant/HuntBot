<script lang="ts">
	import IntersectionObserver from 'svelte-intersection-observer';
	import { navEngaged } from '$lib/nav/navstore';

	import { PrismicImage, SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';

	export let data;

	let element: HTMLElement;
	let onScreen = true;

	$: navEngaged.set(!onScreen);
</script>

<svelte:head>
	<title>Hunter Bryant – Product Designer</title>
	<meta
		name="description"
		content="Hunter Bryant is a product designer with a proven track record of bringing products from ideation to market. With a deep understanding of the challenges faced by teams at all scales of business, I am able to adapt to various design, research, and engineering constraints."
	/>
</svelte:head>

<!-- Handle horizontal bounds -->
<div
	class="inset-x-0 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 py-16 sm:px-8 lg:px-16"
>
	<!-- This div covers the first vertical half of the nav bar -->
	<div
		class="grid h-[calc(calc(50vh-64px)-0.5rem)] grow grid-cols-5 grid-rows-1 gap-4 pt-4 md:grid-cols-7 lg:grid-cols-9"
	>
		<!-- Todo: animate title right after scroll -->
		<div class="col-span-5 col-start-1 row-span-1 row-start-1 flex sm:col-span-4 lg:col-span-5">
			<IntersectionObserver {element} bind:intersecting={onScreen}>
				<h1
					class="z-40 my-auto text-5xl font-bold tracking-tighter xl:text-6xl"
					bind:this={element}
				>
					I’m the designer that will build you a product your users <span class="font-serif italic"
						>really</span
					>
					want.
				</h1>
			</IntersectionObserver>
		</div>
	</div>

	<!-- Personal image -->
	<div
		class="grid h-[calc(50vh-9rem)] grow grid-cols-5 gap-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<div
			class="col-start-4 col-end-6 overflow-hidden rounded bg-stone-200 sm:col-end-7 md:col-end-8 lg:col-end-10"
		>
			<PrismicImage
				field={data.page.data.landing_image}
				class="m-auto block h-full w-full object-cover"
			/>
		</div>
	</div>

	<!-- Case Study -->
	<SliceZone slices={data.page.data.slices} {components} />
</div>
