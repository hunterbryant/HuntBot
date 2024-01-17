import { createClient } from '$lib/prismicio';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const client = createClient();

	const page = await client.getByUID('case_study', params.uid);

	if (page.data.protected) {
		console.log('Password required');
		if (!locals.user) {
			throw redirect(303, '/login');
		}
	}

	return { page };
};
