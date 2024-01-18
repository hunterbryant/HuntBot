import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

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
