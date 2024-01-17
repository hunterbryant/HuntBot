import type { Actions } from './$types';

export const actions = {
	login: async ({ request }) => {
		// TODO log the user in
		const data = await request.formData();
		const password = data.get('password');

		console.log('User typed in password: ', password);

		return { success: true };
	},
	logout: async ({ request }) => {
		console.log('Logging out', request.referrer);
	}
} satisfies Actions;

export const prerender = false;
