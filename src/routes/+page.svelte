<script lang="ts">
	import IntersectionObserver from 'svelte-intersection-observer';
	import { navEngaged, mobile } from '$lib/nav/navstore';

	import { PrismicImage, SliceZone } from '@prismicio/svelte';
	import { components } from '$lib/slices';
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';

	export let data;

	let element: HTMLElement;
	let mobileElement: HTMLElement;
	let onScreen = true;
	let debounced = false;

	// Logic to start scroll onberver
	$: if (debounced && typeof onScreen !== 'undefined') {
		navEngaged.set(!onScreen);
	}

	// Delay scroll observer to avoid multiple scroll events during DOM rendering events
	onMount(() => {
		setTimeout(() => {
			debounced = true;
		}, 500);
	});

	// Similar to the above problem, avoid multiple scroll events when DOM is deconstructed
	beforeNavigate(() => {
		debounced = false;
	});
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
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-2 px-2 pb-16 pt-[4.75rem] sm:gap-4 sm:px-8 sm:pb-24 sm:pt-16 lg:px-16"
>
	<IntersectionObserver element={$mobile ? mobileElement : element} bind:intersecting={onScreen}>
		<!-- Hidden absolute div for mobile scroll detection -->
		<div class="absolute -top-4 h-4" bind:this={mobileElement}></div>
		<!-- This div covers the first vertical half of the nav bar -->
		<div
			class="relative grid h-[calc(50svh-3rem)] grow grid-cols-5 grid-rows-1 gap-4 pt-4 sm:h-[calc(calc(50svh-64px)-0.5rem)] md:grid-cols-7 lg:grid-cols-9"
		>
			<!-- Todo: animate title right after scroll -->
			<div class="col-span-5 col-start-1 row-span-1 row-start-1 flex sm:col-span-4 lg:col-span-5">
				<h1
					class="absolute -top-[3.6rem] my-auto text-5xl font-bold tracking-tighter sm:relative sm:top-0 sm:z-40 xl:text-6xl"
					bind:this={element}
				>
					I’m the designer that will build you a product your users <span class="font-serif italic"
						>really</span
					>
					want.
				</h1>
			</div>
		</div>

		<!-- Personal image -->
		<div
			class="-order-1 grid h-[calc(50svh-4rem)] grow grid-cols-5 gap-4 sm:-order-none sm:h-[calc(50svh-9rem)] sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
		>
			<div
				class="col-start-1 col-end-6 h-full overflow-hidden rounded bg-stone-200 sm:col-start-4 sm:col-end-7 md:col-end-8 lg:col-end-10"
			>
				<PrismicImage
					field={data.page.data.landing_image}
					class="m-auto block h-full w-full object-cover"
				/>
			</div>
		</div>
	</IntersectionObserver>

	<!-- Case Study -->
	<SliceZone slices={data.page.data.slices} {components} />
</div>
