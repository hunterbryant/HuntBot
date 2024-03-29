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
	class="col-span-full mb-4 flex flex-col items-start gap-2 sm:col-span-3 sm:col-start-4 sm:mb-8 md:col-end-8 lg:col-end-9"
>
	{#if slice.variation === 'default'}
		<PrismicImage
			field={slice.primary.image}
			class="rounded border border-black/10 dark:border-white/10 {slice.primary.caption
				? 'mb-0'
				: 'mb-4'}"
		/>
		{#if slice.primary.caption}
			<caption
				class="text-stone-600 mb-2 w-0 min-w-full text-balance text-left text-sm tracking-wide dark:text-stone-400"
				>{slice.primary.caption}</caption
			>
		{/if}
	{:else if slice.variation === 'carousel'}
		<div class="embla" use:emblaCarouselSvelte={{ options, plugins }}>
			<div class="embla__container flex gap-4 {slice.items[0].caption ? 'mb-4' : 'mb-0'}">
				{#each slice.items as item}
					<div
						class="embla__slide relative flex min-w-0 max-w-full flex-[0_0_90%] flex-col items-start gap-2 sm:flex-[0_0_auto]"
					>
						<PrismicImage
							field={item.image}
							class="h-full max-h-56 w-full overflow-hidden rounded border border-black/10 object-cover  sm:max-h-96 dark:border-white/10 "
						/>
						<caption
							class="text-stone-600 w-0 min-w-full text-balance text-left text-sm tracking-wide dark:text-stone-400"
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
