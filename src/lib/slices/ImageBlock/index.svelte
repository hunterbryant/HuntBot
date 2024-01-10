<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicImage } from '@prismicio/svelte';
	import emblaCarouselSvelte from 'embla-carousel-svelte';
	import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures';

	export let slice: Content.ImageBlockSlice;

	let options = { loop: false };
	let plugins = [WheelGesturesPlugin()];

	//Silences runtime svelte unused prop warnings
	$$restProps;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 flex flex-col items-start gap-2 sm:col-span-4 sm:col-start-4 sm:mb-0 md:mb-32"
>
	{#if slice.variation === 'default'}
		<PrismicImage field={slice.primary.image} class="rounded" />
		{#if slice.primary.caption}
			<caption class="text-xs uppercase tracking-wider text-stone-600"
				>{slice.primary.caption}</caption
			>
		{/if}
	{:else if slice.variation === 'carousel'}
		<div class="embla" use:emblaCarouselSvelte={{ options, plugins }}>
			<div class="embla__container flex gap-4">
				{#each slice.items as item}
					<div
						class="embla__slide relative flex min-w-0 flex-[0_0_90%] flex-col items-start gap-2 sm:flex-[0_0_auto]"
					>
						<PrismicImage
							field={item.image}
							class="mr-4 block h-full w-full overflow-hidden rounded object-cover  sm:h-96"
						/>
						<caption class="text-xs uppercase tracking-wider text-stone-600">
							{#if item.caption}
								{item.caption}
							{:else}&nbsp;{/if}
						</caption>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		Slice variation not supported
	{/if}
</section>
