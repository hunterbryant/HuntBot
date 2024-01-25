import { createClient } from '$lib/prismicio';
import type { PageServerLoad } from './$types.js';

export const prerender = true;

export const load = (async ({ fetch, cookies }) => {
	const client = createClient({ fetch, cookies });

	const page = await client.getSingle('information', {
		fetchLinks: [
			'affiliation.title',
			'affiliation.verbose_title',
			'affiliation.logo',
			'affiliation.link'
		]
	});

	return {
		page
	};
}) satisfies PageServerLoad;
