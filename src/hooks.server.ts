import { authenticateUser } from '$lib/server/auth';
import { UserRole } from '$lib/types';
import { redirect, type Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Check for user for each request
	event.locals.user = authenticateUser(event.cookies);

	if (event.url.pathname.startsWith('/admin') && event.locals.user?.role !== UserRole.ADMIN) {
		return new Response(null, {
			status: 303,
			headers: {
				Location: '/login?redirectTo=/admin',
				'Cache-Control': 'no-store'
			}
		});
	}

	const response = await resolve(event);

	return response;
};
