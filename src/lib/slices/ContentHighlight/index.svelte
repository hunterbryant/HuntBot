<script lang="ts">
	import { isFilled, type Content, type ContentRelationshipField } from '@prismicio/client';
	import { PrismicImage } from '@prismicio/svelte';
	import type { CaseStudyDocument, CaseStudyDocumentData } from '../../../prismicio-types';

	export let slice: Content.ContentHighlightSlice;
	let project: CaseStudyDocumentData;

	// This section is to accept the content relationship field as the proper type
	if (
		isFilled.contentRelationship<'case_study', string, CaseStudyDocument['data']>(
			slice.primary.project
		)
	) {
		project = slice.primary.project.data as CaseStudyDocumentData;
	}
</script>

<section
	class="grid h-[calc(50vh-9rem)] grow grid-cols-5 gap-4 sm:grid-cols-9"
	data-slice-type={slice.slice_type}
	data-slice-variation={slice.variation}
>
	Placeholder component for {slice.slice_type} (variation: {slice.variation}) Slices
	<div class="col-start-4 col-end-10 overflow-hidden rounded bg-stone-200">
		<PrismicImage
			field={project.hightlight_image}
			class="m-auto block h-full w-full object-cover"
		/>
	</div>
</section>
