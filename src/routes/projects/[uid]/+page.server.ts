import { createClient } from '$lib/prismicio';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ProjectDocument } from '../../../prismicio-types';

export const load: PageServerLoad = async ({ params }) => {
	const client = createClient();
	let page: ProjectDocument<string>;

	try {
		page = await client.getByUID('project', params.uid);
	} catch (e) {
		error(404, {
			message:
				'I searched all around, but couldnʼt find the right case study. Iʼll let Hunter know so he can check if itʼs an issue on our end.'
		});
	}

	return { page };
};

export const prerender = true;
