import { building } from '$app/environment';
import { createClient } from '$lib/prismicio';
import { authenticateUser } from '$lib/server/auth';
import { redirect, type Handle } from '@sveltejs/kit';
import type { CaseStudyDocument } from './prismicio-types';

export const handle: Handle = async ({ event, resolve }) => {
	// Check for user for each request
	event.locals.user = authenticateUser(event.cookies);

	// Check if route is protected
	if (!building && event.url.pathname.startsWith('/case-studies/')) {
		// Regex to isolate the case study's UID
		const uid = event.url.pathname.replace(/^(\/case-studies\/)/, '');

		const client = createClient();
		let page: CaseStudyDocument<string> | undefined;

		try {
			page = await client.getByUID('case_study', uid);
		} catch (e) {
			event.route = { id: null };
		}

		if (page && page.data.protected && !event.locals.user) {
			redirect(303, `/login?redirectTo=/case-studies/${uid}`);
		}
	}

	const response = await resolve(event);

	return response;
};
