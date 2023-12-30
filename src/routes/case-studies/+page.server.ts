import { createClient } from '$lib/prismicio';
import type { CaseStudyDocument } from '../../prismicio-types';

export const prerender = true;

export async function load({ fetch, cookies }) {
	const client = createClient({ fetch, cookies });

	const page = await client.getAllByType<CaseStudyDocument>('case_study', {
		fetchLinks: 'affiliation.title'
	});

	return {
		page
	};
}

// export async function entries() {
// 	return [{}];
// }
