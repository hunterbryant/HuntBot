<script lang="ts">
	import { isFilled, type Content } from '@prismicio/client';
	import { PrismicImage, PrismicLink } from '@prismicio/svelte';
	import type {
		AffiliationDocumentData,
		AffiliationDocument,
		CaseStudyDocument,
		CaseStudyDocumentData,
		ProjectDocument,
		ProjectDocumentData
	} from '../../../prismicio-types';
	import { Application } from '@splinetool/runtime';
	import { onMount } from 'svelte';

	//Silences runtime svelte unused prop warnings
	$$restProps;
	export let slice: Content.ContentHighlightSlice;

	type Highlightable<T> = T & { type: string; responsibilities: [any] };

	let project: Highlightable<CaseStudyDocumentData | ProjectDocumentData>;
	let affiliation: AffiliationDocumentData;
	let date: Date;
	let projectType: string;
	let interactiveCanvas: HTMLCanvasElement;
	let bgImage: string;

	// This section is to accept the content relationship fields as the proper type (for now it can only be case_study)
	if (
		isFilled.contentRelationship<
			'case_study' | 'project',
			string,
			CaseStudyDocument['data'] | ProjectDocument['data']
		>(slice.primary.project)
	) {
		if (slice.primary.project.type === 'case_study') {
			project = slice.primary.project.data as Highlightable<CaseStudyDocumentData>;
			bgImage = project.highlight_image.url as string;

			date = new Date(project.date as string);
			projectType = 'Case Study';
			project.type = 'case_study';

			// Repeat the content relationship check for the project affiliation
			if (
				isFilled.contentRelationship<'affiliation', string, AffiliationDocument['data']>(
					project.affiliation
				)
			) {
				affiliation = project.affiliation.data as AffiliationDocumentData;
			}
		} else if (slice.primary.project.type === 'project') {
			project = slice.primary.project.data as Highlightable<ProjectDocumentData>;
			bgImage = project.highlight_image.url as string;
			date = new Date(project.date as string);
			projectType = project.project_type as string;
			project.type = 'project';
		}
	}

	onMount(() => {
		if (slice.variation == '3DModel' && slice.primary.model) {
			const app = new Application(interactiveCanvas);
			app.load(slice.primary.model);
		}
	});
</script>

<article
	class="mb-8 grid grow grid-cols-5 items-stretch gap-2 sm:mb-0 sm:h-96 sm:grid-cols-6 sm:gap-4 md:grid-cols-7 lg:grid-cols-9"
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
>
	<!-- Out of box metadata -->
	<div
		class="col-span-full flex flex-col justify-end gap-2 divide-y divide-stone-200 sm:col-span-3 sm:divide-y-0 dark:divide-stone-800"
	>
		<div class="flex flex-row items-baseline justify-between gap-4 sm:hidden">
			<h3 class="mb text-balance text-stone-800 dark:text-stone-200">
				{project.title}
			</h3>
			<p class=" text-xs tracking-wider text-stone-900/50 dark:text-stone-100/50">
				{date.getFullYear()}
			</p>
		</div>
		<div class="flex flex-row gap-4 pt-2 sm:pt-0">
			<div class="flex flex-initial flex-col gap-1">
				<p
					class="col-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
				>
					{#if affiliation}
						Affiliation
					{/if}
				</p>
				<p
					class="col-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
				>
					Type
				</p>
				<p
					class="col-start-1 mt-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
				>
					{#if project.type === 'case_study'}
						Topics
					{/if}
				</p>
			</div>
			<div class="flex flex-1 flex-col gap-1">
				<p
					class="col-span-2 col-start-2 row-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-900 dark:text-stone-100"
				>
					{#if affiliation}
						{affiliation.title}
					{/if}
				</p>
				<p
					class="col-span-2 col-start-2 row-start-2 whitespace-nowrap text-xs uppercase tracking-wider text-stone-900 dark:text-stone-100"
				>
					{projectType}
				</p>
				<div
					class="col-span-2 col-start-2 row-start-3 flex flex-row flex-wrap gap-[2px] whitespace-nowrap text-xs uppercase tracking-wider text-stone-900 dark:text-stone-100"
				>
					{#if project.type === 'case_study'}
						{#each project.responsibilities as responsibility}
							<p class="rounded bg-stone-200 p-1 pb-[2px] tracking-wider dark:bg-stone-800">
								{responsibility.skill}
							</p>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Central image -->
	<PrismicLink
		field={slice.primary.project}
		class="relative col-start-1 col-end-6 row-start-1 h-48
		 cursor-pointer overflow-hidden rounded ring-offset-stone-100 transition hover:ring hover:ring-slate-400 hover:ring-offset-2 sm:z-50 sm:col-start-4 sm:col-end-7 sm:h-auto md:col-end-8 lg:col-end-10 dark:ring-offset-stone-900 dark:hover:ring-slate-500"
	>
		<div class="absolute left-4 top-4 z-10 hidden sm:block">
			<h3 class="mb">{project.title}</h3>
			<p class=" text-xs tracking-wider text-stone-900/50">
				{date.getFullYear()}
			</p>
		</div>
		{#if slice.variation == 'default'}
			<PrismicImage
				field={project.highlight_image}
				class="z-0 m-auto block h-full w-full transform-gpu bg-[#DDDDDD] transition-transform duration-500 hover:scale-110 
				{project.image_fill ? 'object-cover' : 'object-contain'}"
			/>
		{:else}
			<canvas
				bind:this={interactiveCanvas}
				class="bg-[url('{bgImage}') transform-gpu transition-transform duration-500 hover:scale-110"
			></canvas>
		{/if}
	</PrismicLink>
</article>
