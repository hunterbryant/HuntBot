import { env } from '$env/dynamic/private';
import { UserRole, type User } from '$lib/types';
import { fail, redirect } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) return;

	const redirectTo = url.searchParams.get('redirectTo');

	if (locals.user.role === UserRole.ADMIN) {
		redirect(303, redirectTo ? `/${redirectTo.slice(1)}` : '/admin');
	}

	if (locals.user.role === UserRole.USER) {
		if (redirectTo && redirectTo !== '/admin') {
			redirect(303, `/${redirectTo.slice(1)}`);
		}
		redirect(303, '/');
	}
};

export const actions = {
	default: async ({ request, url, cookies }) => {
		const data = await request.formData();
		const password = data.get('password');
		let user: User;

		if (password === env.ADMIN_PASSWORD) {
			// Log the user in and reveice JWT
			user = {
				authenticated: true,
				role: UserRole.ADMIN
			};
		} else if (password === env.AUTH_PASSWORD) {
			// Log the user in and reveice JWT
			user = {
				authenticated: true,
				role: UserRole.USER
			};
		} else {
			return fail(401, { incorrect: true });
		}

		const authToken = jwt.sign(user, env.JWT_KEY as string, { expiresIn: '1h' });
		cookies.set('auth', authToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
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
} satisfies Actions;

export const prerender = false;
