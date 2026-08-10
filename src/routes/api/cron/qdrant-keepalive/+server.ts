import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getQdrantClient } from '$lib/server/qdrant-search';

/**
 * Qdrant Cloud's free tier docs don't specify what counts as "activity" for their
 * inactivity clock (suspends after 1 week, deletes after 4), so this does real
 * data-plane traffic against the collection — a scroll read — rather than a
 * cheap control-plane metadata call, to be the safest bet regardless of how
 * they measure it. Scheduled daily via vercel.json; Hobby plan caps cron
 * frequency at once/day, which is still ~7x margin under the suspension window.
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ success: false }, { status: 401 });
	}

	try {
		const client = getQdrantClient();
		const result = await client.scroll(env.QDRANT_COLLECTION as string, {
			limit: 1,
			with_payload: false,
			with_vector: false
		});

		return json({
			success: true,
			pointsSeen: result.points.length,
			timestamp: new Date().toISOString()
		});
	} catch (err) {
		console.error('Qdrant keepalive ping failed:', err);
		return json({ success: false, error: String(err) }, { status: 500 });
	}
};
