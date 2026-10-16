import { env } from '$env/dynamic/private';
import { authenticateUser } from '$lib/server/auth';
import { UserRole } from '$lib/types';
import { json, redirect, type Handle } from '@sveltejs/kit';

// API routes behind the admin pages: embedding jobs (OpenAI spend, Qdrant writes, iMessage purge)
// and admin settings. The /admin redirect below only covers the pages, not the routes they call.
const ADMIN_API_PREFIXES = ['/api/embed', '/api/admin'];

// The background chunk audit starts its own follow-up runs with CRON_SECRET, since the admin's
// login cookie expires after an hour (see src/routes/api/admin/chunk-audit/+server.ts).
const CRON_SECRET_PATHS = new Set(['/api/admin/chunk-audit']);

function isAdminApiPath(path: string): boolean {
	return ADMIN_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const handle: Handle = async ({ event, resolve }) => {
	// Check for user for each request
	event.locals.user = authenticateUser(event.cookies);

	// Route matching runs on the decoded path, so the checks below must too — otherwise
	// "/%61dmin" reaches /admin without matching the "/admin" prefix.
	let path: string;
	try {
		path = decodeURI(event.url.pathname);
	} catch {
		return new Response('Bad request', { status: 400 });
	}
	const userRole = event.locals.user?.role;
	const hasAuthCookie = !!event.cookies.get('auth');

	// Debug logging for auth redirect issues
	if (path.startsWith('/admin') || path.startsWith('/login')) {
		console.log(
			`[AUTH] ${event.request.method} ${path} | cookie=${hasAuthCookie} role=${userRole}`
		);
	}

	if (isAdminApiPath(path) && userRole !== UserRole.ADMIN) {
		const hasCronSecret =
			CRON_SECRET_PATHS.has(path) &&
			!!env.CRON_SECRET &&
			event.request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
		if (!hasCronSecret) {
			// Visible in the Vercel logs, so probing of the admin API doesn't go unnoticed.
			console.warn(
				'[AUTH] Denied admin API',
				JSON.stringify({ method: event.request.method, path, role: userRole ?? null })
			);
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
	}

	if (path.startsWith('/admin') && userRole !== UserRole.ADMIN) {
		console.log(`[AUTH] Redirecting from ${path} to /login (role=${userRole})`);
		redirect(303, '/login?redirectTo=/admin');
	}

	const response = await resolve(event);

	return response;
};
