import { createClient } from '$lib/prismicio';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const client = createClient();
	const page = await client.getByUID('case_study', params.uid);

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
