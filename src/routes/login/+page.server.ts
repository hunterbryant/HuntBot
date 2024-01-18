import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	// If already logged in continue to destination
	if (locals.user) {
		const redirectTo = url.searchParams.get('redirectTo');

		console.log(redirectTo);
		if (redirectTo) {
			throw redirect(303, `/${redirectTo.slice(1)}`);
		}
		throw redirect(303, '/');
	}
};

export const actions = {
	default: async ({ request, url, cookies }) => {
		// TODO log the user in
		cookies.set('auth', 'userToken', {
			path: '/'
		});

		const redirectTo = url.searchParams.get('redirectTo');
		const data = await request.formData();
		const password = data.get('password');

		if (password !== 'alllowercase') {
			return fail(401, { incorrect: true });
		} else {
			if (redirectTo) {
				// Forces redirect from our domain, not external
				throw redirect(302, `/${redirectTo.slice(1)}`);
			}
			throw redirect(302, '/');
		}
	}
} satisfies Actions;

export const prerender = false;
