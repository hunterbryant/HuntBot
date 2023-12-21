<script lang="ts">
	import { isFilled, type Content, type ContentRelationshipField, asDate } from '@prismicio/client';
	import { PrismicImage } from '@prismicio/svelte';
	import type {
		AffiliationDocumentData,
		AffiliationDocument,
		CaseStudyDocument,
		CaseStudyDocumentData
	} from '../../../prismicio-types';
	import { Application } from '@splinetool/runtime';
	import { onMount } from 'svelte';

	export let slice: Content.ContentHighlightSlice;
	let project: CaseStudyDocumentData;
	let affiliation: AffiliationDocumentData;
	let date: Date;
	let projectType: string;
	let interactiveCanvas: HTMLCanvasElement;
	let bgImage: string;

	// This section is to accept the content relationship fields as the proper type (for now it can only be case_study)
	if (
		isFilled.contentRelationship<'case_study', string, CaseStudyDocument['data']>(
			slice.primary.project
		)
	) {
		project = slice.primary.project.data as CaseStudyDocumentData;
		bgImage = project.hightlight_image.url as string;

		date = new Date(project.date as string);
		projectType = 'Case Study';

		// Repeat the content relationship check for the project affiliation
		if (
			isFilled.contentRelationship<'affiliation', string, AffiliationDocument['data']>(
				project.affiliation
			)
		) {
			affiliation = project.affiliation.data as AffiliationDocumentData;
		}
	}

	onMount(() => {
		if (slice.variation == '3DModel' && slice.primary.model) {
			const app = new Application(interactiveCanvas);
			app.load(slice.primary.model);
		}
	});
</script>

<section
	class="grid h-[calc(50vh-9rem)] grow grid-cols-5 items-stretch gap-4 sm:grid-cols-9"
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
>
	<!-- Out of box metadata -->
	<div class="col-span-3 flex flex-col justify-end gap-4">
		<div class="flex flex-row gap-4">
			<div class="flex flex-initial flex-col gap-1">
				<p class="col-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-500/50">
					Organization
				</p>
				<p class="col-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-500/50">
					Project Type
				</p>
				<p
					class="col-start-1 mt-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-500/50"
				>
					Responsibilities
				</p>
			</div>
			<div class="flex flex-1 flex-col gap-1">
				<p
					class="col-span-2 col-start-2 row-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-900"
				>
					{affiliation.title}
				</p>
				<p
					class="col-span-2 col-start-2 row-start-2 whitespace-nowrap text-xs uppercase tracking-wider text-stone-900"
				>
					{projectType}
				</p>
				<div
					class="col-span-2 col-start-2 row-start-3 flex flex-row flex-wrap gap-[2px] whitespace-nowrap text-xs uppercase tracking-wider text-stone-900"
				>
					{#each project.responsibilities as responsibility}
						<p class="rounded bg-stone-200 p-1 pb-[2px] tracking-wider">{responsibility.skill}</p>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Central image -->
	<div class="relative col-start-4 col-end-10 overflow-hidden rounded bg-zinc-200">
		<div class="absolute left-4 top-4">
			<h3 class="mb">{project.title}</h3>
			<p class=" text-xs tracking-wider text-stone-900/50">
				{date.getFullYear()}
			</p>
		</div>
		{#if slice.variation == 'default'}
			<PrismicImage
				field={project.hightlight_image}
				class="m-auto block h-full w-full object-cover"
			/>
		{:else}
			<canvas bind:this={interactiveCanvas} class="bg-[url('{bgImage}')]"></canvas>
		{/if}
	</div>
</section>
