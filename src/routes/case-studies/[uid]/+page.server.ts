import { createClient } from '$lib/prismicio';
import { error, redirect } from '@sveltejs/kit';
import type { CaseStudyDocument } from '../../../prismicio-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const client = createClient();
	let page: CaseStudyDocument<string>;

	try {
		page = await client.getByUID('case_study', params.uid);
	} catch (e) {
		error(404, {
			message:
				'I searched all around, but couldnʼt find the right case study. Iʼll let Hunter know so he can check if itʼs an issue on our end.'
		});
	}

	if (page.data.protected && !locals.user) {
		redirect(303, `/login?redirectTo=/case-studies/${params.uid}`);
	}

	return { page };
};

// export const entries: EntryGenerator = async () => {
// 	const slugArray: RouteParams[] = [];
// 	const client = createClient();
// 	const page = await client.getAllByType<CaseStudyDocument>('case_study');

// 	page.forEach((caseStudy) => {
// 		if (!caseStudy.data.protected) {
// 			slugArray.push({ uid: caseStudy.uid });
// 		}
// 	});

// 	console.log(slugArray);

// 	return slugArray;
// };

export const prerender = false;
