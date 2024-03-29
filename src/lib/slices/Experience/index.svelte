<script lang="ts">
	import { isFilled, type Content, LinkType, asLink } from '@prismicio/client';
	import type { AffiliationDocument, ExperienceSliceDefaultItem } from '../../../prismicio-types';
	import { PrismicImage, PrismicLink, PrismicRichText } from '@prismicio/svelte';

	export let slice: Content.ExperienceSlice;

	//Silences runtime svelte unused prop warnings
	$$restProps;

	// Silence ts warnings about the affiliation type
	function typeAffliation(experience: ExperienceSliceDefaultItem) {
		if (
			isFilled.contentRelationship<'affiliation', string, AffiliationDocument['data']>(
				experience.affiliation
			)
		) {
			if (isFilled.link(experience.affiliation.data?.link)) {
				if (experience.affiliation.data.link.url !== undefined) {
					return experience.affiliation;
				}
			}
		}
	}
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-16 grid grow grid-cols-subgrid items-stretch gap-4 gap-y-4 sm:mb-16 md:mb-32"
>
	<!-- Out of box metadata -->
	<div
		class="col-span-1 col-start-1 row-start-1 mt-1 flex flex-col justify-start gap-2 text-left text-xs uppercase tracking-wider text-stone-500 sm:col-start-3 dark:text-stone-400"
	>
		Experience
	</div>

	<!-- Experience Blocks -->
	<div
		class="col-span-full row-start-2 grid grid-cols-subgrid gap-y-12 sm:col-start-4 sm:row-start-1 sm:gap-y-16"
	>
		{#each slice.items as item}
			<div class="col-span-full grid grid-cols-subgrid gap-y-6">
				<div class="col-span-5 flex flex-col items-start sm:col-span-3 lg:col-span-2">
					<div
						class="flex flex-row items-center justify-stretch gap-4 lg:flex-col lg:items-start [&>img]:opacity-90 dark:[&>img]:invert"
					>
						<PrismicImage field={typeAffliation(item)?.data?.logo} />
						<div>
							<h3 class="font-bold leading-tight text-stone-800 dark:text-stone-200">
								{item.title}
							</h3>

							<a
								href={asLink(typeAffliation(item)?.data?.link)}
								class=" text-stone-600 decoration-slate-400 decoration-2 underline-offset-2 transition-all hover:underline dark:text-stone-400 dark:decoration-slate-600"
							>
								{typeAffliation(item)?.data?.verbose_title ?? typeAffliation(item)?.data?.title} ↗
							</a>
						</div>
					</div>
					<div class="flex flex-col items-start">
						<p
							class="mt-6 rounded bg-stone-200 p-1 pb-[2px] text-xs uppercase tracking-wider text-stone-900 lg:mt-6 dark:bg-stone-800 dark:text-stone-100"
						>
							{item.timeframe}
						</p>
						{#if item.caption}
							<p
								class="mt-1 rounded p-1 pb-[2px] text-xs font-medium uppercase tracking-wider text-stone-600 dark:text-stone-400"
							>
								{item.caption}
							</p>
						{/if}
					</div>
				</div>
				<div class="col-span-5 text-stone-600 sm:col-span-3 md:col-span-4 dark:text-stone-400">
					<PrismicRichText field={item.body} />
				</div>
			</div>
		{/each}
	</div>
</section>
