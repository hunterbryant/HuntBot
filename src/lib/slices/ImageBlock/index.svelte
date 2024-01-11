<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicImage } from '@prismicio/svelte';
	import emblaCarouselSvelte from 'embla-carousel-svelte';
	import type { EmblaOptionsType } from 'embla-carousel';
	import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures';

	export let slice: Content.ImageBlockSlice;

	let options: EmblaOptionsType = { loop: false, align: 'start', skipSnaps: true };
	let plugins = [WheelGesturesPlugin()];

	//Silences runtime svelte unused prop warnings
	$$restProps;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-4 flex flex-col items-start gap-2 sm:col-span-4 sm:col-start-4 sm:mb-8"
>
	{#if slice.variation === 'default'}
		<PrismicImage field={slice.primary.image} class="rounded outline outline-1 outline-black/10" />
		{#if slice.primary.caption}
			<caption class="mb-2 text-balance text-left text-xs uppercase tracking-wider text-stone-500"
				>{slice.primary.caption}</caption
			>
		{/if}
	{:else if slice.variation === 'carousel'}
		<div class="embla" use:emblaCarouselSvelte={{ options, plugins }}>
			<div class="embla__container flex gap-4">
				{#each slice.items as item}
					<div
						class="embla__slide relative flex min-w-0 max-w-full flex-[0_0_90%] flex-col items-start gap-2 sm:flex-[0_0_auto]"
					>
						<PrismicImage
							field={item.image}
							class="h-full max-h-56 w-full overflow-hidden rounded object-cover outline outline-1 outline-black/10 sm:max-h-96 "
						/>
						<caption
							class="w-0 min-w-full text-balance text-left text-xs uppercase tracking-wider text-stone-500 {item.caption
								? 'mb-4'
								: 'mb-0'}"
						>
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
