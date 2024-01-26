import { createClient } from '$lib/prismicio';
import type { PageServerLoad } from './$types';

export const load = (async ({ fetch, cookies }) => {
	const client = createClient({ fetch, cookies });
	const page = await client.getSingle('other_projects', {
		fetchLinks: [
			'project.highlight_image',
			'project.title',
			'project.project_type',
			'project.image_fill',
			'project.bg_color'
		]
	});

	return { page };
}) satisfies PageServerLoad;
