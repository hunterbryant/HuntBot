import { env } from '$env/dynamic/private';
import { auditUntaggedChunks } from '$lib/server/chunk-audit';
import { json, type RequestHandler } from '@sveltejs/kit';

// Leave headroom under the function limit for the last batch and its Qdrant write.
const RUN_BUDGET_MS = 45_000;

export const config = { maxDuration: 60 };

/**
 * Daily Vercel Cron (vercel.json): tags knowledge-base chunks that don't have a current
 * `metadata.audit` yet, so retrieval can skip boilerplate and sensitive chunks without anyone
 * re-running the embedders. Each run picks up where the last one stopped.
 */
export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ success: false }, { status: 401 });
	}

	try {
		const run = await auditUntaggedChunks(RUN_BUDGET_MS);
		console.log('[HuntBot chunk audit]', JSON.stringify(run));
		return json({ success: true, ...run, timestamp: new Date().toISOString() });
	} catch (err) {
		console.error('Chunk audit failed:', err);
		return json({ success: false, error: String(err) }, { status: 500 });
	}
};
