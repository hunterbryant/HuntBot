import { createClient } from '$lib/prismicio';
import type { CaseStudyDocument } from '../../prismicio-types';

export const prerender = false;

export async function load({ fetch, cookies, locals }) {
	const client = createClient({ fetch, cookies });

	const page = await client.getAllByType<CaseStudyDocument>('case_study', {
		orderings: {
			field: 'my.case_study.date',
			direction: 'desc'
		},
		fetchLinks: 'affiliation.title'
	});

	// Scrub sensitive data when unauthed
	page.forEach((caseStudy) => {
		if (!locals.user && caseStudy.data.protected) {
			caseStudy.data.title = 'Protected';
			caseStudy.data.meta_title = 'Protected';
			caseStudy.data.slices = [];
			caseStudy.data.meta_description = 'Protected, enter password to view';
			caseStudy.data.hightlight_image.alt = 'A blurred thumbnail image';
		}
	});

	return {
		page
	};
}
