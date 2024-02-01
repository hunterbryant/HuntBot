<script lang="ts">
	import thumbnail from '$lib/assets/case-studies.jpg';
	import { PrismicImage, PrismicLink } from '@prismicio/svelte';
	import { isFilled, type DateField, documentToLinkField } from '@prismicio/client';
	import type { AffiliationDocument, CaseStudyDocument } from '../../prismicio-types.js';
	import LockClosed from '$lib/assets/lock-closed.svelte';

	export let data;

	function formatDate(date: DateField) {
		let dateObj = new Date(date as string);
		return dateObj.getFullYear();
	}

	// Silence ts warnings about the affiliation type
	function typeAffliation(caseStudy: CaseStudyDocument) {
		if (
			isFilled.contentRelationship<'affiliation', string, AffiliationDocument['data']>(
				caseStudy.data.affiliation
			)
		) {
			return caseStudy.data.affiliation;
		}
	}
</script>

<svelte:head>
	<title>Case Studies</title>
	<meta name="description" content="Hunter Bryant's case studies and writing" />
	<meta property="og:title" content="Case Studies" />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={thumbnail} />
	<meta property="og:description" content="Hunter Bryant's case studies and writing" />
</svelte:head>

<!-- Handle horizontal bounds -->
<div
	class="inset-x-0 z-30 mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-2 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-0 lg:px-16"
>
	<!-- Grid -->
	<div
		class="grid grow auto-rows-min grid-cols-5 gap-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9"
	>
		<div
			class="col-start-1 col-end-6 mb-4 mt-12 flex flex-col justify-end rounded text-6xl font-bold tracking-tighter text-stone-800 sm:col-start-4 sm:col-end-7 sm:mb-16 sm:mt-0 sm:h-[24.5rem] sm:text-5xl md:col-end-8 md:text-7xl lg:col-end-10 lg:text-8xl xl:text-9xl dark:text-stone-200"
		>
			<h2 class="mb-0 sm:-mb-2 md:-mb-4 lg:-mb-5">Case Studies</h2>
		</div>

		{#each data.page as caseStudy}
			<article
				class="col-span-full mb-8 grid grow grid-cols-subgrid items-end gap-2 sm:mb-0 sm:gap-4"
			>
				<!-- Title Block -->
				<PrismicLink
					field={documentToLinkField(caseStudy)}
					class="group col-span-2 hidden cursor-pointer flex-col justify-end px-0 pt-1 sm:flex"
				>
					<p class=" text-xs tracking-wider text-stone-400 dark:text-stone-500">
						{formatDate(caseStudy.data.date)}
					</p>
					<h3
						class="text-balance text-stone-800 decoration-slate-400 decoration-2 underline-offset-2 transition-all group-hover:underline dark:text-stone-200 dark:decoration-slate-500"
					>
						{caseStudy.data.title}
					</h3>
				</PrismicLink>

				<!-- Out of box metadata -->
				<div
					class="col-span-full grid grid-cols-subgrid justify-end gap-y-1 divide-y divide-stone-200 sm:col-span-3 sm:col-start-3 sm:divide-y-0 dark:divide-stone-800"
				>
					<div class="col-span-full flex flex-row items-end justify-between gap-4 sm:hidden">
						<h3 class="mb text-balance text-stone-800 dark:text-stone-200">
							{caseStudy.data.title}
						</h3>
						<p class=" mb-1 text-xs tracking-wider text-stone-400 dark:text-stone-500">
							{formatDate(caseStudy.data.date)}
						</p>
					</div>
					<div class="col-span-full grid grid-cols-subgrid pt-2 sm:pt-0">
						<div class="col-span-2 flex flex-col gap-1 sm:col-span-1">
							<p
								class="col-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
							>
								Affiliation
							</p>
							<p
								class="col-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
							>
								Type
							</p>
							<p
								class="col-start-1 mt-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
							>
								topics
							</p>
						</div>
						<div class="col-span-3 flex flex-col gap-1 sm:col-span-2">
							<p
								class="col-span-2 col-start-2 row-start-1 whitespace-nowrap text-xs uppercase tracking-wider text-stone-900 dark:text-stone-100"
							>
								{typeAffliation(caseStudy)?.data?.title}
							</p>
							<p
								class="col-span-2 col-start-2 row-start-2 whitespace-nowrap text-xs uppercase tracking-wider text-stone-900 dark:text-stone-100"
							>
								Case Study
							</p>
							<div
								class="col-span-2 col-start-2 row-start-3 flex flex-row flex-wrap gap-[2px] whitespace-nowrap text-xs uppercase tracking-wider text-stone-900 dark:text-stone-100"
							>
								{#each caseStudy.data.responsibilities as responsibility}
									<p class="rounded bg-stone-200 p-1 pb-[2px] tracking-wider dark:bg-stone-800">
										{responsibility.skill}
									</p>
								{/each}
							</div>
						</div>
					</div>
				</div>

				<!-- Central image -->
				<PrismicLink
					field={documentToLinkField(caseStudy)}
					class="relative col-start-1 col-end-6 row-start-1
		 h-32 cursor-pointer overflow-hidden rounded bg-zinc-200 ring-offset-stone-100 transition hover:ring hover:ring-slate-400 hover:ring-offset-2 sm:col-start-6 sm:col-end-7 md:col-end-8 lg:col-end-10 dark:ring-offset-stone-900 dark:hover:ring-slate-500"
				>
					<PrismicImage
						field={caseStudy.data.highlight_image}
						imgixParams={caseStudy.data.title === 'Protected' ? { blur: 1000 } : {}}
						class="z-0 m-auto block h-full w-full transform-gpu bg-[#DDDDDD]  transition-transform duration-500 hover:scale-110 {caseStudy
							.data.image_fill
							? 'object-cover'
							: 'object-contain'}"
					/>
					{#if caseStudy.data.title === 'Protected'}
						<div
							class="align absolute left-1 top-1 flex items-start gap-0.5 rounded bg-stone-800 px-1.5 pb-0.5 pt-1 text-xs font-normal uppercase tracking-wider text-stone-100 [&_svg]:mt-px [&_svg]:inline [&_svg]:h-3 [&_svg]:w-3"
						>
							Protected <LockClosed />
						</div>
					{/if}
				</PrismicLink>
			</article>
		{/each}
	</div>
</div>
