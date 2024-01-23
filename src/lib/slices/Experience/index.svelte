<script lang="ts">
	import { isFilled, type Content } from '@prismicio/client';
	import type {
		AffiliationDocument,
		AffiliationDocumentData,
		ExperienceSlice,
		ExperienceSliceDefaultItem
	} from '../../../prismicio-types';
	import { PrismicImage } from '@prismicio/svelte';

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
			console.log(experience.affiliation);
			return experience.affiliation;
		}
	}
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 sm:mb-0 md:mb-32"
>
	<!-- Out of box metadata -->
	<div
		class="col-span-1 col-start-1 row-start-1 mt-1 flex flex-col justify-start gap-2 text-left text-xs uppercase tracking-wider text-stone-500 sm:col-start-3"
	>
		Experience
	</div>

	<!-- Experience Blocks -->
	<div
		class="col-span-full row-start-2 grid grid-cols-subgrid gap-y-8 sm:col-start-4 sm:row-start-1 sm:gap-y-16"
	>
		{#each slice.items as item}
			<div class="col-span-full grid grid-cols-subgrid">
				<div class="col-span-2 flex flex-col items-start">
					<PrismicImage field={typeAffliation(item)?.data?.logo} height="64" />
					<h3 class="mt-8 font-bold leading-tight">{item.title}</h3>
					<p class="text-stone-600">
						{typeAffliation(item)?.data?.verbose_title ?? typeAffliation(item)?.data?.title}
					</p>
					<p
						class="mt-6 rounded bg-stone-200 p-1 pb-[2px] text-xs uppercase tracking-wider text-stone-900"
					>
						{item.timeframe}
					</p>
					{#if item.caption}
						<p class="mt-1 rounded p-1 pb-[2px] text-xs uppercase tracking-wider text-stone-600">
							{item.caption}
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</section>
