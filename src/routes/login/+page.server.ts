import type { Actions } from './$types';

export const actions = {
	default: async ({ request }) => {
		// TODO log the user in
		const data = await request.formData();
		const password = data.get('password');

		console.log('User typed in password: ', password);

		return { success: true };
	}
} satisfies Actions;

export const prerender = false;
