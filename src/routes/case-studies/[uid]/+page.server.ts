import { createClient } from '$lib/prismicio';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const client = createClient();

	const page = await client.getByUID('case_study', params.uid);

	if (page.data.protected) {
		if (!locals.user) {
			const redirectTo = url.pathname + url.search;
			throw redirect(303, `/login?redirectTo=${redirectTo}`);
		}
	}

	return { page };
};
