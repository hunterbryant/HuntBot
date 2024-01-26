<script lang="ts">
	import type { Content } from '@prismicio/client';
	import { PrismicRichText } from '@prismicio/svelte';

	//Silences runtime svelte unused prop warnings
	$$restProps;

	export let slice: Content.ExpertiseSlice;
</script>

<section
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="col-span-full mb-8 grid grow grid-cols-subgrid items-stretch gap-4 sm:mb-16"
>
	<!-- Out of box metadata -->
	<div
		class="text-stone-500 col-span-1 col-start-1 row-start-1 mt-1 flex flex-col justify-start gap-2 text-left text-xs uppercase tracking-wider sm:col-start-3"
	>
		Expertise
	</div>

	<!-- Skill Blocks -->
	<div
		class="col-span-full row-start-2 mb-8 grid grid-cols-subgrid gap-y-8 sm:col-start-4 sm:row-start-1 sm:mb-0 sm:gap-y-16 md:mb-16"
	>
		{#each slice.items as item}
			<div class="col-span-full grid grid-cols-subgrid gap-4 sm:col-span-4 lg:col-span-3">
				<h3
					class="text-stone-800 col-span-full mb-2 font-bold leading-tight dark:text-stone-200 sm:col-span-2 sm:mb-0 lg:col-span-1"
				>
					{item.skill_name}
				</h3>
				<ul
					class="col-span-4 col-start-2 flex flex-row flex-wrap content-start items-start gap-x-1 gap-y-1 sm:col-span-3 sm:col-start-auto md:col-span-2"
				>
					{#if item.skill_tags}
						{#each item.skill_tags.split(',') as skill}
							<li
								class="text-stone-900 bg-stone-200 rounded p-1 pb-[2px] text-xs uppercase tracking-wider dark:text-stone-100 dark:bg-stone-800"
							>
								{skill}
							</li>
						{/each}
					{/if}
				</ul>
				<div
					class="*:text-balanced text-stone-600 col-span-full col-start-2 dark:text-stone-400 sm:col-start-1"
				>
					<PrismicRichText field={item.skill_decription} />
				</div>
			</div>
		{/each}
	</div>
</section>
