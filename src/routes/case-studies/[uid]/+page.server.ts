import { createClient } from '$lib/prismicio';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = createClient();

	const page = await client.getByUID('case_study', params.uid);

	if (page) {
		return { page };
	}

	error(404, 'Not found');
};
