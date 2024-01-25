import { createClient } from '$lib/prismicio';
import type { PageServerLoad } from './$types';

export const load = (async ({ fetch, cookies }) => {
	const client = createClient({ fetch, cookies });
	const page = await client.getSingle('other_projects');

	return { page };
}) satisfies PageServerLoad;
