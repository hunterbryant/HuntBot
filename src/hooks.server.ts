import { authenticateUser } from '$lib/server/auth';
import { UserRole } from '$lib/types';
import { redirect, type Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Check for user for each request
	event.locals.user = authenticateUser(event.cookies);

	const path = event.url.pathname;
	const userRole = event.locals.user?.role;
	const hasAuthCookie = !!event.cookies.get('auth');

	// Debug logging for auth redirect issues
	if (path.startsWith('/admin') || path.startsWith('/login')) {
		console.log(`[AUTH] ${event.request.method} ${path} | cookie=${hasAuthCookie} role=${userRole}`);
	}

	if (path.startsWith('/admin') && userRole !== UserRole.ADMIN) {
		console.log(`[AUTH] Redirecting from ${path} to /login (role=${userRole})`);
		redirect(303, '/login?redirectTo=/admin');
	}

	const response = await resolve(event);

	return response;
};
