import { createClient } from '$lib/prismicio';

export const prerender = true;

export async function load({ fetch, cookies }) {
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
}
