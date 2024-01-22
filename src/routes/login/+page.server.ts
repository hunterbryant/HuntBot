import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import type { User } from '../../app';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	// If already logged in continue to destination
	if (locals.user) {
		const redirectTo = url.searchParams.get('redirectTo');

		if (redirectTo) {
			redirect(303, `/${redirectTo.slice(1)}`);
		}

		redirect(303, '/');
	}
};

export const actions = {
	default: async ({ request, url, cookies }) => {
		const data = await request.formData();
		const password = data.get('password');

		if (password !== env.AUTH_PASSWORD) {
			return fail(401, { incorrect: true });
		} else {
			// Log the user in and reveice JWT
			const user: User = {
				authenticated: true
			};

			const authToken = jwt.sign(user, env.JWT_KEY as string, { expiresIn: '1h' });
			cookies.set('auth', authToken, {
				path: '/',
				httpOnly: true,
				sameSite: 'strict',
				secure: process.env.NODE_ENV === 'production',
				maxAge: 60 * 60 // 1 hour
			});

			const redirectTo = url.searchParams.get('redirectTo');

			if (redirectTo) {
				// Forces redirect from our domain, not external
				redirect(302, `/${redirectTo.slice(1)}`);
			} else {
				redirect(302, '/');
			}
		}
	}
} satisfies Actions;

export const prerender = false;
