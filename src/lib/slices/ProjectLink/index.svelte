<script lang="ts">
	import { isFilled, type Content } from '@prismicio/client';
	import { PrismicImage, PrismicLink } from '@prismicio/svelte';
	import type { ProjectDocument, ProjectDocumentData } from '../../../prismicio-types';

	export let slice: Content.ProjectLinkSlice;

	//Silences runtime svelte unused prop warnings
	$$restProps;

	let project: ProjectDocumentData;
	let color: string;

	// Silence ts warnings about the affiliation type
	if (
		isFilled.contentRelationship<'project', string, ProjectDocument['data']>(slice.primary.project)
	) {
		project = slice.primary.project.data as ProjectDocumentData;
	}
</script>

<PrismicLink
	field={slice.primary.project}
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
	class="group col-span-full flex cursor-pointer flex-col sm:col-span-3 md:col-span-2"
>
	<div
		class="h-32 w-full overflow-hidden rounded transition group-hover:ring group-hover:ring-slate-400 group-hover:ring-offset-2 md:aspect-square md:h-auto dark:group-hover:ring-slate-600"
	>
		<PrismicImage
			field={project.highlight_image}
			class="h-full w-full transform-gpu rounded transition-transform  duration-500 group-hover:scale-110  {project.image_fill
				? 'object-cover'
				: 'object-contain'} "
		></PrismicImage>
	</div>
	<h3
		class="text-stone-800 mt-4 text-balance leading-tight decoration-slate-400 decoration-2 underline-offset-2 transition-all dark:text-stone-200 group-hover:underline dark:decoration-slate-600"
	>
		{project.title}
	</h3>
	<p class="text-stone-500 mt-1 text-xs font-medium uppercase tracking-wider">
		{project.project_type}
	</p>
</PrismicLink>
